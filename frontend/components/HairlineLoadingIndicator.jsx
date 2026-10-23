export default function HairlineLoadingIndicator({ color = '#14120e', size = 16 }) {
  return (
    <span
      className="loading-indicator"
      style={{ color, width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
