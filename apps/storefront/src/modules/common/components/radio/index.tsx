/**
 * The radio dot rendered inside a larger, already-interactive option row.
 *
 * ## Why it is `aria-hidden` and not a control
 *
 * Its only consumer is `checkout/components/address-select`, whose rows are
 * Headless UI `Listbox.Option`s — i.e. already `role="option"` inside a
 * `role="listbox"`, with selection announced by `aria-selected`. Rendering a
 * `role="radio"` inside an option announced a second, contradictory widget to
 * a screen-reader user: a radio group that does not exist, inside a listbox
 * that does. `payment-container` hit the same defect and dropped this component
 * outright rather than nest one control in another.
 *
 * So this is now what it always visually was — an indicator. The parent option
 * owns the semantics; this owns the dot. It is also no longer a `<button>`,
 * because a button inside an option is a second tab stop and a click target
 * that swallows the row's own click.
 */
const Radio = ({
  checked,
  "data-testid": dataTestId,
}: {
  checked: boolean
  "data-testid"?: string
}) => {
  return (
    <span
      aria-hidden="true"
      data-state={checked ? "checked" : "unchecked"}
      className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center"
      data-testid={dataTestId || "radio-button"}
    >
      <span
        className={
          checked
            ? "flex h-[18px] w-[18px] items-center justify-center rounded-full border-[5px] border-coral bg-paper transition-colors"
            : "flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-paper transition-colors"
        }
      />
    </span>
  )
}

export default Radio
