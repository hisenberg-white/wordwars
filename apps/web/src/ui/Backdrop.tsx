/**
 * The ambient background used behind every out-of-match screen.
 *
 * Two opposing light sources — crimson on the left, cyan on the right —
 * so even an empty menu screen reads as a standoff. It is doing narrative
 * work, not decoration.
 *
 * Purely CSS: no canvas, no JS, no per-frame cost. The menus must never
 * compete with the game for frame budget.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-void" />

      {/* Opposing corner glows: the two fighters, abstracted. */}
      <div
        className="animate-pulse-glow absolute -left-[15%] top-[10%] h-[50rem] w-[50rem] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgb(255 47 87 / 0.22), transparent 65%)' }}
      />
      <div
        className="animate-pulse-glow absolute -right-[15%] bottom-[5%] h-[50rem] w-[50rem] rounded-full blur-[120px]"
        style={{
          background: 'radial-gradient(circle, rgb(0 224 255 / 0.18), transparent 65%)',
          animationDelay: '1.2s',
        }}
      />

      <div className="bg-grid absolute inset-0 opacity-40" />
      <div className="bg-scanlines absolute inset-0 opacity-60" />

      {/* Vignette — pulls the eye to centre, the way a fighting stage does. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 35%, #06060b 100%)' }}
      />
    </div>
  );
}
