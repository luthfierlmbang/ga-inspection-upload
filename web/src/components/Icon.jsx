// Small stroke icons drawn for this app (camera, image, close, chevrons, zoom, retry, check).
const paths = {
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5a1 1 0 1 0 0-.01',
  close: 'M6 6l12 12 M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l4 4 M8 11h6 M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l4 4 M8 11h6',
  retry: 'M4 12a8 8 0 0 1 14-5.3 M18 3v4h-4 M20 12a8 8 0 0 1-14 5.3 M6 21v-4h4',
  check: 'M5 12.5l4.5 4.5L19 7',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.5 15.5L20 20',
  plus: 'M12 5v14 M5 12h14',
};

export default function Icon({ name, size = 20, strokeWidth = 2, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
