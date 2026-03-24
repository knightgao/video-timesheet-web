import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackgroundMode,
  ColorKeyOptions,
  ColorSample,
  ExportMode,
  ExtractedFrame,
  KeyAlgorithm,
  PreviewMode,
  ProcessedFrame,
  RenderResult,
  SheetOptions,
  VideoMeta,
} from './types';
import {
  applyColorKey,
  processExtractedFrame,
  sampleCanvasColor,
} from './lib/chromaKey';
import {
  buildTransparentFramesZip,
  getBaseFileName,
  getSheetFileName,
  getZipFileName,
} from './lib/exportBundle';
import { getSheetAppearance, renderFrameSheet } from './lib/sheet';
import { formatTimestamp } from './lib/time';
import {
  createVideoFrameReader,
  extractFrames,
  loadVideoAsset,
  revokeVideoAsset,
  type VideoFrameReader,
} from './lib/video';

const DEFAULT_FRAME_COUNT = 12;
const DEFAULT_COLUMNS = 4;
const DEFAULT_GAP = 8;
const DEFAULT_BG = '#ffffff';
const DEFAULT_BACKGROUND_MODE: BackgroundMode = 'color-key';
const DEFAULT_KEY_ALGORITHM: KeyAlgorithm = 'enhanced';
const DEFAULT_TOLERANCE = 28;
const DEFAULT_SOFTNESS = 14;
const DEFAULT_DESPILL = 50;
const DEFAULT_EDGE_RADIUS = 22;
const DEFAULT_SAMPLE_RADIUS = 6;

type SamplePoint = {
  x: number;
  y: number;
};

type GeneratedAssets = {
  frames: ExtractedFrame[];
  processed: ProcessedFrame[] | null;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawCanvas(
  target: HTMLCanvasElement | null,
  source: HTMLCanvasElement | null,
  marker?: SamplePoint | null,
): void {
  if (!target || !source) {
    return;
  }

  target.width = source.width;
  target.height = source.height;

  const context = target.getContext('2d');
  if (!context) {
    return;
  }

  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);

  if (!marker) {
    return;
  }

  context.save();
  context.strokeStyle = '#ff8f1f';
  context.lineWidth = Math.max(2, source.width / 220);
  context.beginPath();
  context.arc(marker.x, marker.y, Math.max(10, source.width / 50), 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#ff8f1f';
  context.beginPath();
  context.arc(marker.x, marker.y, Math.max(3, source.width / 130), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function toTransparentSheetFrames(processedFrames: ProcessedFrame[]): ExtractedFrame[] {
  return processedFrames.map(({ processedImage, ...frame }) => ({
    ...frame,
    image: processedImage,
  }));
}

function App() {
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(DEFAULT_FRAME_COUNT);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [gap, setGap] = useState(DEFAULT_GAP);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(DEFAULT_BACKGROUND_MODE);
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>(DEFAULT_KEY_ALGORITHM);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [softness, setSoftness] = useState(DEFAULT_SOFTNESS);
  const [despill, setDespill] = useState(DEFAULT_DESPILL);
  const [edgeRadius, setEdgeRadius] = useState(DEFAULT_EDGE_RADIUS);
  const [sampleRadius, setSampleRadius] = useState(DEFAULT_SAMPLE_RADIUS);
  const [smoothing, setSmoothing] = useState(true);
  const [despillEnabled, setDespillEnabled] = useState(true);
  const [referenceTime, setReferenceTime] = useState(0);
  const [referenceFrame, setReferenceFrame] = useState<HTMLCanvasElement | null>(null);
  const [referenceResultFrame, setReferenceResultFrame] = useState<HTMLCanvasElement | null>(null);
  const [referenceMaskFrame, setReferenceMaskFrame] = useState<HTMLCanvasElement | null>(null);
  const [samplePoint, setSamplePoint] = useState<SamplePoint | null>(null);
  const [colorSample, setColorSample] = useState<ColorSample | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result');
  const [previewExportMode, setPreviewExportMode] = useState<Exclude<ExportMode, 'transparent-frames-zip'>>(
    'transparent-sheet',
  );
  const [result, setResult] = useState<RenderResult | null>(null);
  const [status, setStatus] = useState('请选择一个本地视频开始生成。');
  const [isDragging, setIsDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [readerReady, setReaderReady] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[] | null>(null);
  const [processedFrames, setProcessedFrames] = useState<ProcessedFrame[] | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const readerRef = useRef<VideoFrameReader | null>(null);
  const readerTokenRef = useRef(0);
  const hasInitializedInvalidationRef = useRef(false);
  const latestVideoUrlRef = useRef<string | null>(null);
  const latestResultRef = useRef<RenderResult | null>(null);

  const sheetOptions: SheetOptions = {
    columns,
    gap,
    backgroundColor,
  };

  const baseFileName = useMemo(
    () => getBaseFileName(videoMeta?.name ?? 'video'),
    [videoMeta?.name],
  );

  const stats = useMemo(() => {
    if (!videoMeta) {
      return [];
    }

    return [
      ['文件名', videoMeta.name],
      ['时长', `${videoMeta.duration.toFixed(2)} 秒`],
      ['分辨率', `${videoMeta.width} × ${videoMeta.height}`],
      ['参考帧', formatTimestamp(referenceTime)],
    ];
  }, [referenceTime, videoMeta]);

  const colorKeyOptions = useMemo<ColorKeyOptions | null>(() => {
    if (!colorSample) {
      return null;
    }

    return {
      sample: colorSample,
      tolerance,
      softness,
      despill,
      sampleRadius,
      edgeRadius,
      smoothing,
      despillEnabled,
      algorithm,
    };
  }, [
    algorithm,
    colorSample,
    despill,
    despillEnabled,
    edgeRadius,
    sampleRadius,
    smoothing,
    softness,
    tolerance,
  ]);

  const canGenerate = Boolean(
    videoMeta &&
      videoUrl &&
      !isRendering &&
      (backgroundMode === 'none' || colorKeyOptions),
  );
  const hasGeneratedAssets = Boolean(extractedFrames?.length);
  const canExportTransparent = Boolean(processedFrames?.length);

  function replacePreviewResult(next: RenderResult | null): void {
    setResult((current) => {
      if (current) {
        URL.revokeObjectURL(current.objectUrl);
      }

      return next;
    });
  }

  function disposeReferenceReader(): void {
    readerRef.current?.dispose();
    readerRef.current = null;
  }

  function clearGeneratedAssets(nextStatus?: string): void {
    setExtractedFrames(null);
    setProcessedFrames(null);
    replacePreviewResult(null);
    if (nextStatus) {
      setStatus(nextStatus);
    }
  }

  useEffect(() => {
    latestVideoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    latestResultRef.current = result;
  }, [result]);

  useEffect(() => {
    return () => {
      disposeReferenceReader();

      if (latestVideoUrlRef.current) {
        revokeVideoAsset(latestVideoUrlRef.current);
      }

      if (latestResultRef.current) {
        URL.revokeObjectURL(latestResultRef.current.objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!videoUrl || !videoMeta) {
      disposeReferenceReader();
      setReferenceFrame(null);
      return;
    }

    let cancelled = false;
    const token = ++readerTokenRef.current;

    setIsReferenceLoading(true);

    void createVideoFrameReader(videoUrl)
      .then((reader) => {
        if (cancelled || token !== readerTokenRef.current) {
          reader.dispose();
          return;
        }

        disposeReferenceReader();
        readerRef.current = reader;
        setReaderReady((value) => value + 1);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : '参考帧读取失败。');
      })
      .finally(() => {
        if (!cancelled && token === readerTokenRef.current) {
          setIsReferenceLoading(false);
        }
      });

    return () => {
      cancelled = true;
      readerTokenRef.current += 1;
      disposeReferenceReader();
    };
  }, [videoMeta, videoUrl]);

  useEffect(() => {
    if (!videoMeta || !readerRef.current) {
      return;
    }

    let cancelled = false;
    const token = ++readerTokenRef.current;

    setIsReferenceLoading(true);

    void readerRef.current
      .captureFrameAt(referenceTime)
      .then((canvas) => {
        if (cancelled || token !== readerTokenRef.current) {
          return;
        }

        setReferenceFrame(canvas);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : '参考帧更新失败。');
      })
      .finally(() => {
        if (!cancelled && token === readerTokenRef.current) {
          setIsReferenceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [readerReady, referenceTime, videoMeta]);

  useEffect(() => {
    if (!referenceFrame || !samplePoint) {
      setColorSample(null);
      return;
    }

    try {
      setColorSample(sampleCanvasColor(referenceFrame, samplePoint.x, samplePoint.y, sampleRadius));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '颜色取样失败。');
    }
  }, [referenceFrame, samplePoint, sampleRadius]);

  useEffect(() => {
    if (!referenceFrame) {
      setReferenceResultFrame(null);
      setReferenceMaskFrame(null);
      return;
    }

    if (backgroundMode !== 'color-key' || !colorKeyOptions) {
      setReferenceResultFrame(referenceFrame);
      setReferenceMaskFrame(null);
      return;
    }

    try {
      const preview = applyColorKey(referenceFrame, colorKeyOptions);
      setReferenceResultFrame(preview.image);
      setReferenceMaskFrame(preview.mask);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '参考帧预览失败。');
    }
  }, [backgroundMode, colorKeyOptions, referenceFrame]);

  useEffect(() => {
    drawCanvas(referenceCanvasRef.current, referenceFrame, samplePoint);
  }, [referenceFrame, samplePoint]);

  useEffect(() => {
    const source =
      previewMode === 'mask'
        ? referenceMaskFrame
        : referenceResultFrame ?? referenceFrame;
    drawCanvas(previewCanvasRef.current, source);
  }, [previewMode, referenceFrame, referenceMaskFrame, referenceResultFrame]);

  useEffect(() => {
    if (!hasInitializedInvalidationRef.current) {
      hasInitializedInvalidationRef.current = true;
      return;
    }

    if (!extractedFrames && !processedFrames && !result) {
      return;
    }

    clearGeneratedAssets('参数已更新，请重新生成最新结果。');
  }, [
    algorithm,
    backgroundColor,
    backgroundMode,
    colorSample?.hex,
    columns,
    despill,
    despillEnabled,
    edgeRadius,
    extractedFrames,
    gap,
    includeTimestamps,
    processedFrames,
    result,
    samplePoint?.x,
    samplePoint?.y,
    sampleRadius,
    smoothing,
    softness,
    tolerance,
    videoUrl,
    frameCount,
  ]);

  async function updateFile(file: File): Promise<void> {
    setError(null);
    setStatus('正在读取视频元数据...');

    disposeReferenceReader();
    setReferenceFrame(null);
    setReferenceResultFrame(null);
    setReferenceMaskFrame(null);
    setSamplePoint(null);
    setColorSample(null);
    clearGeneratedAssets();

    if (videoUrl) {
      revokeVideoAsset(videoUrl);
      setVideoUrl(null);
    }

    try {
      const asset = await loadVideoAsset(file);
      setVideoMeta(asset.meta);
      setVideoUrl(asset.url);
      setReferenceTime(Number((asset.meta.duration / 2).toFixed(3)));
      setPreviewExportMode(backgroundMode === 'color-key' ? 'transparent-sheet' : 'sheet');
      setStatus('视频已就绪，先在参考帧上点一下背景颜色，再生成结果。');
    } catch (nextError) {
      setVideoMeta(null);
      setStatus('读取失败，请换一个文件后重试。');
      setError(nextError instanceof Error ? nextError.message : '读取视频失败。');
    }
  }

  function handleDrop(fileList: FileList | null): void {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    void updateFile(file);
  }

  async function generateAssets(): Promise<GeneratedAssets> {
    if (!videoMeta || !videoUrl) {
      throw new Error('请先上传一个视频文件。');
    }

    if (backgroundMode === 'color-key' && !colorKeyOptions) {
      throw new Error('请先在参考帧上点击背景颜色。');
    }

    setError(null);
    setIsRendering(true);

    try {
      setStatus(`正在抽取序列帧 0/${frameCount}...`);
      const frames = await extractFrames(
        videoUrl,
        videoMeta,
        {
          frameCount,
          includeTimestamps,
        },
        (current, total) => {
          setStatus(`正在抽取序列帧 ${current}/${total}...`);
        },
      );

      let nextProcessedFrames: ProcessedFrame[] | null = null;

      if (backgroundMode === 'color-key' && colorKeyOptions) {
        nextProcessedFrames = [];

        for (const [index, frame] of frames.entries()) {
          setStatus(`正在执行 ChromaKey 抠像 ${index + 1}/${frames.length}...`);
          nextProcessedFrames.push(processExtractedFrame(frame, colorKeyOptions));
          if (index < frames.length - 1) {
            await nextFrame();
          }
        }
      }

      setExtractedFrames(frames);
      setProcessedFrames(nextProcessedFrames);

      return {
        frames,
        processed: nextProcessedFrames,
      };
    } finally {
      setIsRendering(false);
    }
  }

  async function ensureAssets(): Promise<GeneratedAssets> {
    if (extractedFrames) {
      return {
        frames: extractedFrames,
        processed: processedFrames,
      };
    }

    return generateAssets();
  }

  async function renderSheetPreview(
    mode: Exclude<ExportMode, 'transparent-frames-zip'>,
    assets?: GeneratedAssets,
  ): Promise<RenderResult> {
    if (!videoMeta) {
      throw new Error('请先上传视频。');
    }

    const currentAssets = assets ?? (await ensureAssets());
    const transparent = mode === 'transparent-sheet';
    const framesForRender = transparent
      ? currentAssets.processed
        ? toTransparentSheetFrames(currentAssets.processed)
        : null
      : currentAssets.frames;

    if (!framesForRender) {
      throw new Error('透明序列表需要先开启背景扣像并完成取色。');
    }

    setStatus(transparent ? '正在拼接透明序列表...' : '正在拼接普通序列表...');
    const nextResult = await renderFrameSheet(
      framesForRender,
      videoMeta,
      sheetOptions,
      includeTimestamps,
      getSheetAppearance(transparent),
    );

    replacePreviewResult(nextResult);
    setPreviewExportMode(mode);
    setStatus('生成完成，可以继续预览或下载。');

    return nextResult;
  }

  async function handleGeneratePreview(): Promise<void> {
    try {
      const assets = await ensureAssets();
      const defaultMode =
        backgroundMode === 'color-key' && assets.processed ? 'transparent-sheet' : 'sheet';
      await renderSheetPreview(defaultMode, assets);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '生成失败。');
      setStatus('生成失败，请调整参数后重试。');
    }
  }

  async function handleDownloadSheet(
    mode: Exclude<ExportMode, 'transparent-frames-zip'>,
  ): Promise<void> {
    try {
      const nextResult = await renderSheetPreview(mode);
      triggerBlobDownload(nextResult.blob, getSheetFileName(baseFileName, mode === 'transparent-sheet'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导出失败。');
      setStatus('导出失败，请稍后再试。');
    }
  }

  async function handleDownloadZip(): Promise<void> {
    try {
      const assets = await ensureAssets();
      if (!assets.processed) {
        throw new Error('透明帧 ZIP 需要先启用背景扣像并完成取色。');
      }

      setError(null);
      setIsRendering(true);
      setStatus('正在打包透明 PNG ZIP...');
      const blob = await buildTransparentFramesZip(assets.processed, baseFileName);
      triggerBlobDownload(blob, getZipFileName(baseFileName));
      setStatus('透明 PNG ZIP 已生成并开始下载。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '打包 ZIP 失败。');
      setStatus('ZIP 导出失败，请稍后再试。');
    } finally {
      setIsRendering(false);
    }
  }

  function handleReferenceCanvasClick(event: React.MouseEvent<HTMLCanvasElement>): void {
    if (backgroundMode !== 'color-key' || !referenceFrame || !referenceCanvasRef.current) {
      return;
    }

    const rect = referenceCanvasRef.current.getBoundingClientRect();
    const ratioX = referenceFrame.width / rect.width;
    const ratioY = referenceFrame.height / rect.height;
    const x = Math.round((event.clientX - rect.left) * ratioX);
    const y = Math.round((event.clientY - rect.top) * ratioY);

    setSamplePoint({
      x,
      y,
    });
    setStatus('背景颜色已采样，可以继续调整容差、羽化和去溢色。');
  }

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <main className="app-card">
        <section className="hero">
          <p className="eyebrow">本地处理 · 纯前端扣像 · GitHub Pages 友好</p>
          <h1>视频转序列帧表 2.0</h1>
          <p className="hero-copy">
            先在参考帧中点击背景颜色，再批量执行浏览器端 ChromaKey 抠像，
            输出透明序列表 PNG 和透明单帧 ZIP。
          </p>
        </section>

        <section className="workspace-grid">
          <div className="panel upload-panel">
            <div className="panel-head">
              <h2>1. 上传视频</h2>
              <span className="status-chip">{status}</span>
            </div>

            <button
              className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleDrop(event.dataTransfer.files);
              }}
            >
              <span className="dropzone-kicker">拖放视频到这里</span>
              <strong>或点击选择本地文件</strong>
              <small>推荐使用单色背景视频。纯前端处理时，长视频会消耗更多浏览器内存。</small>
            </button>

            <input
              ref={inputRef}
              hidden
              accept="video/*"
              type="file"
              onChange={(event) => {
                handleDrop(event.target.files);
                event.currentTarget.value = '';
              }}
            />

            <div className="stats-grid">
              {stats.length > 0 ? (
                stats.map(([label, value]) => (
                  <div className="stat-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))
              ) : (
                <div className="stat-empty">选择视频后，这里会显示时长、分辨率和参考帧信息。</div>
              )}
            </div>
          </div>

          <div className="panel controls-panel">
            <div className="panel-head">
              <h2>2. 输出与背景模式</h2>
              <span>{backgroundMode === 'color-key' ? 'ChromaKey 已启用' : '普通序列表模式'}</span>
            </div>

            <div className="mode-switch">
              <label className={`mode-pill ${backgroundMode === 'color-key' ? 'is-active' : ''}`}>
                <input
                  checked={backgroundMode === 'color-key'}
                  name="background-mode"
                  type="radio"
                  onChange={() => {
                    setBackgroundMode('color-key');
                    setPreviewExportMode('transparent-sheet');
                    setStatus('已切换到背景扣像模式，请选择背景颜色。');
                  }}
                />
                <span>点选背景色扣像</span>
              </label>

              <label className={`mode-pill ${backgroundMode === 'none' ? 'is-active' : ''}`}>
                <input
                  checked={backgroundMode === 'none'}
                  name="background-mode"
                  type="radio"
                  onChange={() => {
                    setBackgroundMode('none');
                    setPreviewExportMode('sheet');
                    setStatus('已切换到普通序列表模式。');
                  }}
                />
                <span>无抠像</span>
              </label>
            </div>

            <div className="control-grid">
              <label className="field">
                <span>抽帧数量</span>
                <input
                  min={1}
                  max={60}
                  type="number"
                  value={frameCount}
                  onChange={(event) => setFrameCount(Number(event.target.value) || 1)}
                />
              </label>

              <label className="field">
                <span>每行列数</span>
                <input
                  min={1}
                  max={8}
                  type="number"
                  value={columns}
                  onChange={(event) => setColumns(Number(event.target.value) || 1)}
                />
              </label>

              <label className="field">
                <span>帧间距</span>
                <input
                  min={0}
                  max={48}
                  type="number"
                  value={gap}
                  onChange={(event) => setGap(Number(event.target.value) || 0)}
                />
              </label>

              <label className="field">
                <span>普通模式背景色</span>
                <div className="color-field">
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(event) => setBackgroundColor(event.target.value)}
                  />
                  <code>{backgroundColor}</code>
                </div>
              </label>
            </div>

            <label className="toggle">
              <input
                checked={includeTimestamps}
                type="checkbox"
                onChange={(event) => setIncludeTimestamps(event.target.checked)}
              />
              <span>在每一帧下显示时间戳</span>
            </label>

            <div className="option-card">
              <span>当前输出</span>
              <strong>
                {columns} 列 · 间距 {gap}px · {backgroundMode === 'color-key' ? '透明导出优先' : '普通 PNG 导出'}
              </strong>
            </div>

            <button
              className="primary-button"
              disabled={!canGenerate}
              type="button"
              onClick={() => void handleGeneratePreview()}
            >
              {isRendering ? '正在处理...' : '3. 生成结果'}
            </button>

            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </section>

        <section className="panel chroma-panel">
          <div className="panel-head panel-head--stack">
            <div>
              <h2>3. 抠图算法与参考帧</h2>
              <span>参考你给的模式，先选算法，再在参考帧上点一下背景颜色。</span>
            </div>
          </div>

          <div className="algorithm-grid">
            <label className={`algorithm-card ${algorithm === 'enhanced' ? 'is-active' : ''}`}>
              <input
                checked={algorithm === 'enhanced'}
                name="algorithm"
                type="radio"
                onChange={() => setAlgorithm('enhanced')}
              />
              <div>
                <strong>⭐ 增强 ChromaKey（推荐）</strong>
                <p>使用加权 RGB 色距、平滑羽化和边缘去溢色，适合复杂阴影和轻微杂色背景。</p>
              </div>
            </label>

            <label className={`algorithm-card algorithm-card--emerald ${algorithm === 'classic' ? 'is-active' : ''}`}>
              <input
                checked={algorithm === 'classic'}
                name="algorithm"
                type="radio"
                onChange={() => setAlgorithm('classic')}
              />
              <div>
                <strong>🎯 经典 ChromaKey</strong>
                <p>更偏硬阈值，参数更直接，适合背景非常纯净的绿幕、蓝幕或单色墙面。</p>
              </div>
            </label>
          </div>

          {backgroundMode === 'none' ? (
            <div className="hint-card">
              当前处于“无抠像”模式。你仍然可以生成普通序列表；如果要导出透明图，请切换回“点选背景色扣像”。
            </div>
          ) : (
            <>
              <div className="reference-toolbar">
                <label className="range-block">
                  <span>参考帧时间</span>
                  <input
                    max={videoMeta?.duration ?? 0}
                    min={0}
                    step={0.01}
                    type="range"
                    value={referenceTime}
                    onChange={(event) => setReferenceTime(Number(event.target.value))}
                  />
                </label>

                <div className="reference-meta">
                  <strong>{videoMeta ? formatTimestamp(referenceTime) : '00:00.000'}</strong>
                  <span>{isReferenceLoading ? '参考帧更新中...' : '点击左侧原图取背景色'}</span>
                </div>
              </div>

              <div className="sample-badge-row">
                <div className="sample-badge">
                  <span
                    className="sample-swatch"
                    style={{ backgroundColor: colorSample?.hex ?? '#e6e8f3' }}
                  />
                  <div>
                    <strong>
                      {colorSample
                        ? `RGB(${colorSample.rgb.r}, ${colorSample.rgb.g}, ${colorSample.rgb.b})`
                        : '尚未选择背景颜色'}
                    </strong>
                    <span>
                      {samplePoint
                        ? `位置: (${samplePoint.x}, ${samplePoint.y})`
                        : '请在左侧原图中点击一个背景点'}
                    </span>
                  </div>
                </div>

                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setSamplePoint(null);
                    setColorSample(null);
                  }}
                >
                  清除颜色
                </button>
              </div>

              <div className="reference-grid">
                <div className="canvas-card">
                  <div className="canvas-head">
                    <span>原图</span>
                    <small>点击背景取样</small>
                  </div>
                  <div className="canvas-surface">
                    <canvas
                      ref={referenceCanvasRef}
                      className="preview-canvas"
                      onClick={handleReferenceCanvasClick}
                    />
                  </div>
                </div>

                <div className="canvas-card">
                  <div className="canvas-head">
                    <span>抠图预览结果</span>
                    <div className="segmented-control">
                      <button
                        className={`segmented-button ${previewMode === 'result' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => setPreviewMode('result')}
                      >
                        抠像结果
                      </button>
                      <button
                        className={`segmented-button ${previewMode === 'mask' ? 'is-active' : ''}`}
                        disabled={!referenceMaskFrame}
                        type="button"
                        onClick={() => setPreviewMode('mask')}
                      >
                        Alpha 蒙版
                      </button>
                    </div>
                  </div>
                  <div className="canvas-surface checkerboard">
                    <canvas ref={previewCanvasRef} className="preview-canvas" />
                  </div>
                </div>
              </div>

              <div className="advanced-panel">
                <div className="advanced-head">
                  <h3>高级参数设置</h3>
                  <span>容差、羽化、采样半径、去溢色都会即时影响右侧预览。</span>
                </div>

                <div className="advanced-grid">
                  <label className="range-field">
                    <span>颜色容差: {tolerance}</span>
                    <input
                      max={120}
                      min={0}
                      type="range"
                      value={tolerance}
                      onChange={(event) => setTolerance(Number(event.target.value))}
                    />
                    <small>越大越容易把接近背景色的区域一起抠除。</small>
                  </label>

                  <label className="range-field">
                    <span>羽化半径: {softness}px</span>
                    <input
                      max={60}
                      min={0}
                      type="range"
                      value={softness}
                      onChange={(event) => setSoftness(Number(event.target.value))}
                    />
                    <small>控制边缘从透明到不透明的过渡长度。</small>
                  </label>

                  <label className="range-field">
                    <span>边缘去溢色强度: {despill}%</span>
                    <input
                      max={100}
                      min={0}
                      type="range"
                      value={despill}
                      onChange={(event) => setDespill(Number(event.target.value))}
                    />
                    <small>用于压掉边缘残留的背景色，值越大处理越明显。</small>
                  </label>

                  <label className="range-field">
                    <span>边缘检测半径: {edgeRadius}px</span>
                    <input
                      max={60}
                      min={0}
                      type="range"
                      value={edgeRadius}
                      onChange={(event) => setEdgeRadius(Number(event.target.value))}
                    />
                    <small>控制去溢色主要作用在多宽的边缘区域内。</small>
                  </label>

                  <label className="range-field">
                    <span>颜色采样半径: {sampleRadius}px</span>
                    <input
                      max={20}
                      min={0}
                      type="range"
                      value={sampleRadius}
                      onChange={(event) => setSampleRadius(Number(event.target.value))}
                    />
                    <small>取样时会平均周围像素，适合带轻微噪点的背景。</small>
                  </label>

                  <div className="toggle-group">
                    <label className="toggle-card">
                      <input
                        checked={smoothing}
                        type="checkbox"
                        onChange={(event) => setSmoothing(event.target.checked)}
                      />
                      <span>边缘平滑</span>
                    </label>

                    <label className="toggle-card">
                      <input
                        checked={despillEnabled}
                        type="checkbox"
                        onChange={(event) => setDespillEnabled(event.target.checked)}
                      />
                      <span>溢色移除</span>
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="result-grid">
          <div className="panel preview-panel">
            <div className="panel-head">
              <h2>4. 结果预览</h2>
              <span>{result ? `${result.outputWidth} × ${result.outputHeight}` : '等待生成'}</span>
            </div>

            <div className="segmented-control segmented-control--export">
              <button
                className={`segmented-button ${previewExportMode === 'sheet' ? 'is-active' : ''}`}
                disabled={!hasGeneratedAssets}
                type="button"
                onClick={() => void renderSheetPreview('sheet')}
              >
                普通序列表
              </button>
              <button
                className={`segmented-button ${previewExportMode === 'transparent-sheet' ? 'is-active' : ''}`}
                disabled={!canExportTransparent}
                type="button"
                onClick={() => void renderSheetPreview('transparent-sheet')}
              >
                透明序列表
              </button>
            </div>

            {result ? (
              <div className="preview-wrap">
                <img alt="生成的序列帧表预览" className="preview-image" src={result.objectUrl} />
              </div>
            ) : (
              <div className="preview-empty">
                先生成结果。普通模式会预览标准序列表，扣像模式会默认预览透明序列表。
              </div>
            )}
          </div>

          <div className="panel download-panel">
            <div className="panel-head">
              <h2>5. 导出结果</h2>
              <span>本地下载</span>
            </div>

            <p className="download-copy">
              第二版支持普通序列表、透明序列表，以及逐帧透明 PNG ZIP。
            </p>

            <div className="export-actions">
              <button
                className="secondary-button"
                disabled={!videoMeta || isRendering}
                type="button"
                onClick={() => void handleDownloadSheet('sheet')}
              >
                下载普通序列表 PNG
              </button>

              <button
                className="secondary-button secondary-button--violet"
                disabled={!videoMeta || isRendering || backgroundMode !== 'color-key' || !colorKeyOptions}
                type="button"
                onClick={() => void handleDownloadSheet('transparent-sheet')}
              >
                下载透明序列表 PNG
              </button>

              <button
                className="secondary-button secondary-button--emerald"
                disabled={!videoMeta || isRendering || backgroundMode !== 'color-key' || !colorKeyOptions}
                type="button"
                onClick={() => void handleDownloadZip()}
              >
                下载透明单帧 ZIP
              </button>
            </div>

            <div className="hint-card hint-card--soft">
              {backgroundMode === 'color-key'
                ? '透明导出会保留真正的 Alpha 通道，不再填充实体背景色。'
                : '当前处于普通模式，透明导出按钮会在生成时提示你先切换到背景扣像模式。'}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
