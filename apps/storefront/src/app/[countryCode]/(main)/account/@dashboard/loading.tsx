import Spinner from "@modules/common/icons/spinner"

export default function Loading() {
  return (
    <div className="flex min-h-[360px] w-full items-center justify-center text-coral">
      <Spinner size={36} />
    </div>
  )
}
