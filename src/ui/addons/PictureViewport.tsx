import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PictureViewportContext } from "./pictureViewportContext";

/** Keep controls/state mounted, but release drawing resources outside one viewport.
 * Freeze the measured layout height while the drawing subtree is hidden.
 */
export function PictureViewport({ children, placeholderHeight = 160, className }: { children: ReactNode; placeholderHeight?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ near, height }, setViewport] = useState(() => ({ near: typeof IntersectionObserver === "undefined", height: placeholderHeight }));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const root = node.closest<HTMLElement>("[data-reader-scroll]");
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (visible === entry.isIntersecting) return;
      const near = entry.isIntersecting;
      visible = near;
      const measured = node.getBoundingClientRect().height;
      setViewport(prev => ({ near, height: near ? prev.height : measured }));
    }, { root, rootMargin: `${root?.clientHeight || window.innerHeight}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={near ? undefined : { height }}>
      <PictureViewportContext.Provider value={near}>
        <div style={near ? undefined : { display: "none" }}>{children}</div>
      </PictureViewportContext.Provider>
    </div>
  );
}
