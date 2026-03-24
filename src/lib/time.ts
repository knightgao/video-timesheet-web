export function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMilliseconds = Math.round(clamped * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const time =
    hours > 0
      ? [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
      : [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');

  return `${time}.${String(milliseconds).padStart(3, '0')}`;
}

