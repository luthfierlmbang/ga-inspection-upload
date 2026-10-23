import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function Lightbox({ photos, index, onClose, onIndex }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const touch = useRef(null);
  const closeRef = useRef(null);
  const photo = photos[index];
  const count = photos.length;

  const go = useCallback(
    (d) => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      onIndex((index + d + count) % count);
    },
    [index, count, onIndex],
  );

  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, pan: { ...pan }, multi: e.touches.length > 1 };
  };
  const onTouchMove = (e) => {
    if (!touch.current || zoom === 1) return;
    const t = e.touches[0];
    setPan({ x: touch.current.pan.x + (t.clientX - touch.current.x), y: touch.current.pan.y + (t.clientY - touch.current.y) });
  };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start || start.multi || zoom !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const toggleZoom = () => {
    setZoom((z) => (z === 1 ? 2.5 : 1));
    setPan({ x: 0, y: 0 });
  };

  if (!photo) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Foto ${index + 1} dari ${count}`}>
      <div className="lb-top">
        <span className="lb-count">
          {index + 1} / {count}
        </span>
        <div className="lb-tools">
          <button type="button" className="icon-btn icon-btn-dark" onClick={toggleZoom} aria-label={zoom === 1 ? 'Perbesar' : 'Perkecil'}>
            <Icon name={zoom === 1 ? 'zoomIn' : 'zoomOut'} />
          </button>
          <button type="button" ref={closeRef} className="icon-btn icon-btn-dark" onClick={onClose} aria-label="Tutup foto">
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="lb-stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onDoubleClick={toggleZoom}>
        <img
          key={photo.id}
          src={photo.url}
          alt={photo.caption || `Foto ${index + 1}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          draggable="false"
        />
      </div>
      {count > 1 && (
        <>
          <button type="button" className="lb-nav lb-prev" onClick={() => go(-1)} aria-label="Foto sebelumnya">
            <Icon name="left" size={24} />
          </button>
          <button type="button" className="lb-nav lb-next" onClick={() => go(1)} aria-label="Foto berikutnya">
            <Icon name="right" size={24} />
          </button>
        </>
      )}
      <div className="lb-caption">
        {photo.stageLabel && <span className="lb-stagelabel">{photo.stageLabel}</span>}
        <p>{photo.caption || 'Tanpa keterangan'}</p>
      </div>
    </div>
  );
}
