export const STEPS = ['Location', 'Time', 'Vehicle', 'Slot', 'Review', 'Confirmation'];
export default function BookingStepper({ current }) {
  return (
    <ol className="stepper" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'now' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="n">{i < current ? '\u2713' : i + 1}</span><span className="t">{s}</span>
        </li>))}
    </ol>
  );
}
