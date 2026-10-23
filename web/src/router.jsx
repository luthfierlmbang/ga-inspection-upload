import { useEffect, useState, useCallback } from 'react';

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return loc;
}

export function Link({ to, children, className, ...rest }) {
  const onClick = useCallback(
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(to);
    },
    [to],
  );
  return (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
