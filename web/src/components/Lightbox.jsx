import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function Lightbox({ photos, index, onClose, onIndex }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(0);
  const touch = useRef(null);
  const closeRef = useRef(null);
  const photo = photos[index];
  const count = photos.length;

  const go = useCallback(
    (d) => {
      if (count < 2) return;
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setDrag(0);
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
    if (!touch.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (zoom === 1) {
      // Follow the finger horizontally so the swipe feels physical.
      if (!touch.current.multi && count > 1 && Math.abs(dx) > Math.abs(dy)) setDrag(dx);
      return;
    }
    setPan({ x: touch.current.pan.x + dx, y: touch.current.pan.y + dy });
  };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    setDrag(0);
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
  const tx = zoom === 1 ? drag : pan.x;
  const ty = zoom === 1 ? 0 : pan.y;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Foto ${index + 1} dari ${count}`}>
      <div className="lb-top">
        <span className="lb-count" aria-live="polite">
          {index + 1} / {count}
        </span>
        <div className="lb-tools">
          <button type="button" className="lb-tool" onClick={toggleZoom} aria-label={zoom === 1 ? 'Perbesar' : 'Perkecil'}>
            <Icon name={zoom === 1 ? 'zoomIn' : 'zoomOut'} size={20} />
          </button>
          <button type="button" ref={closeRef} className="lb-tool" onClick={onClose} aria-label="Tutup foto">
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>
      <div className="lb-stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onDoubleClick={toggleZoom}>
        <img
          key={photo.id}
          src={photo.url}
          alt={photo.caption || `Foto ${index + 1}`}
          className={drag ? 'is-dragging' : ''}
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }}
          draggable="false"
        />
        {count > 1 && (
          <>
            <button type="button" className="lb-nav lb-prev" onClick={() => go(-1)} aria-label="Foto sebelumnya">
              <span className="lb-nav-vis">
                <Icon name="left" size={22} strokeWidth={2.5} />
              </span>
            </button>
            <button type="button" className="lb-nav lb-next" onClick={() => go(1)} aria-label="Foto berikutnya">
              <span className="lb-nav-vis">
                <Icon name="right" size={22} strokeWidth={2.5} />
              </span>
            </button>
          </>
        )}
      </div>
      <div className="lb-caption">
        {photo.stageLabel && <p className="lb-stagelabel">{photo.stageLabel}</p>}
        <p className={photo.caption ? 'lb-text' : 'lb-text lb-none'}>{photo.caption || 'Tanpa keterangan'}</p>
        {count > 1 && <p className="lb-hint">Geser kiri atau kanan untuk foto lain. Ketuk dua kali untuk zoom.</p>}
      </div>
    </div>
  );
}
