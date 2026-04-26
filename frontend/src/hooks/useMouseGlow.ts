import { useEffect, useRef } from "react";

export function useMouseGlow(containerRef: React.RefObject<HTMLElement>) {
  const rafRef = useRef<number>();
  const mouseX = useRef(50);
  const mouseY = useRef(50);
  const currentX = useRef(50);
  const currentY = useRef(50);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseX.current = ((e.clientX - rect.left) / rect.width) * 100;
      mouseY.current = ((e.clientY - rect.top) / rect.height) * 100;
      container.classList.add("active");
    };

    const handleMouseLeave = () => {
      container.classList.remove("active");
    };

    const animate = () => {
      // Smooth easing
      currentX.current += (mouseX.current - currentX.current) * 0.08;
      currentY.current += (mouseY.current - currentY.current) * 0.08;

      container.style.setProperty("--mouse-x", `${currentX.current}%`);
      container.style.setProperty("--mouse-y", `${currentY.current}%`);

      rafRef.current = requestAnimationFrame(animate);
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef]);
}