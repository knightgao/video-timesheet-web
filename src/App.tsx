import { useEffect, useMemo, useRef, useState } from 'react';
import type { RenderResult, SheetOptions, VideoMeta } from './types';
import { extractFrames, loadVideoAsset, revokeVideoAsset } from './lib/video';
import { renderFrameSheet } from './lib/sheet';

const DEFAULT_FRAME_COUNT = 12;
const DEFAULT_COLUMNS = 4;
const DEFAULT_GAP = 8;
const DEFAULT_BG = '#ffffff';

function App() {
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(DEFAULT_FRAME_COUNT);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [gap, setGap] = useState(DEFAULT_GAP);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [status, setStatus] = useState('请选择一个本地视频开始生成。');
  const [isDragging, setIsDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) {
        revokeVideoAsset(videoUrl);
      }

      if (result) {
        URL.revokeObjectURL(result.objectUrl);
      }
    };
  }, [result, videoUrl]);

  const canRender = Boolean(videoMeta && videoUrl && !isRendering);

  const stats = useMemo(() => {
    if (!videoMeta) {
      return [];
    }

    return [
      ['文件名', videoMeta.name],
      ['时长', `${videoMeta.duration.toFixed(2)} 秒`],
      ['分辨率', `${videoMeta.width} × ${videoMeta.height}`],
    ];
  }, [videoMeta]);

  async function updateFile(file: File): Promise<void> {
    setError(null);
    setStatus('正在读取视频元数据...');

    if (videoUrl) {
      revokeVideoAsset(videoUrl);
      setVideoUrl(null);
    }

    if (result) {
      URL.revokeObjectURL(result.objectUrl);
      setResult(null);
    }

    try {
      const asset = await loadVideoAsset(file);
      setVideoMeta(asset.meta);
      setVideoUrl(asset.url);
      setStatus('视频已就绪，现在可以生成序列表。');
    } catch (nextError) {
      setVideoMeta(null);
      setStatus('读取失败，请换一个文件后重试。');
      setError(nextError instanceof Error ? nextError.message : '读取视频失败。');
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!videoMeta || !videoUrl) {
      return;
    }

    setError(null);
    setIsRendering(true);
    setStatus('正在抽取序列帧...');

    if (result) {
      URL.revokeObjectURL(result.objectUrl);
      setResult(null);
    }

    try {
      const frames = await extractFrames(videoUrl, videoMeta, {
        frameCount,
        includeTimestamps,
      });

      setStatus('正在拼接序列表图片...');
      const nextSheet = await renderFrameSheet(
        frames,
        videoMeta,
        {
          columns,
          gap,
          backgroundColor,
        },
        includeTimestamps,
      );

      setResult(nextSheet);
      setStatus('生成完成，可以预览或下载 PNG。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '生成失败。');
      setStatus('生成失败，请调整参数后重试。');
    } finally {
      setIsRendering(false);
    }
  }

  function handleDrop(fileList: FileList | null): void {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    void updateFile(file);
  }

  const sheetOptions: SheetOptions = {
    columns,
    gap,
    backgroundColor,
  };

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <main className="app-card">
        <section className="hero">
          <p className="eyebrow">本地处理 · 零上传 · GitHub Pages 友好</p>
          <h1>视频转序列帧表</h1>
          <p className="hero-copy">
            把本地视频均匀抽成多张关键帧，再自动拼成一张干净的 PNG 序列表。
            全流程都在浏览器里完成，不经过服务器。
          </p>
        </section>

        <section className="workspace-grid">
          <div className="panel upload-panel">
            <div className="panel-head">
              <h2>1. 上传视频</h2>
              <span>{status}</span>
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
              <small>推荐使用常见 MP4(H.264) 视频，处理速度取决于视频长度与分辨率。</small>
            </button>

            <input
              ref={inputRef}
              hidden
              accept="video/*"
              type="file"
              onChange={(event) => handleDrop(event.target.files)}
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
                <div className="stat-empty">选择视频后，这里会显示时长与分辨率信息。</div>
              )}
            </div>
          </div>

          <div className="panel controls-panel">
            <div className="panel-head">
              <h2>2. 调整参数</h2>
              <span>输出设置</span>
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
                <span>背景颜色</span>
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
              <span>当前布局</span>
              <strong>
                {sheetOptions.columns} 列 · 间距 {sheetOptions.gap}px ·
                {includeTimestamps ? ' 含时间戳' : ' 纯图模式'}
              </strong>
            </div>

            <button className="primary-button" disabled={!canRender} type="button" onClick={() => void handleGenerate()}>
              {isRendering ? '正在生成...' : '3. 生成序列表'}
            </button>

            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </section>

        <section className="result-grid">
          <div className="panel preview-panel">
            <div className="panel-head">
              <h2>3. 预览结果</h2>
              <span>{result ? `${result.outputWidth} × ${result.outputHeight}` : '等待生成'}</span>
            </div>

            {result ? (
              <div className="preview-wrap">
                <img alt="生成的序列帧表预览" className="preview-image" src={result.objectUrl} />
              </div>
            ) : (
              <div className="preview-empty">
                序列表会显示在这里。你可以先上传视频，再按需修改参数并生成。
              </div>
            )}
          </div>

          <div className="panel download-panel">
            <div className="panel-head">
              <h2>4. 下载 PNG</h2>
              <span>本地导出</span>
            </div>

            <p className="download-copy">
              导出文件名会沿用视频名，并自动追加 `-timesheet.png` 后缀。
            </p>

            <a
              className={`download-link ${result ? '' : 'is-disabled'}`}
              download={`${videoMeta?.name.replace(/\.[^.]+$/, '') ?? 'video'}-timesheet.png`}
              href={result?.objectUrl ?? '#'}
            >
              下载序列表 PNG
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;

