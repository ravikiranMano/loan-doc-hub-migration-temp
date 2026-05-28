import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets window scroll to top on route path changes.
 * Deferred to the next animation frame so the scroll happens after the new
 * route has rendered — eliminates visible jump/flicker during transition.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);
  return null;
};

export default ScrollToTop;
