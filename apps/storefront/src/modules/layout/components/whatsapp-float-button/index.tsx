import { FaWhatsapp } from "react-icons/fa"

// Fixed floating CTA, bottom-right, visible on every page that mounts it.
// Uses WhatsApp's own brand green — a floating chat bubble only reads as
// "tap to chat" when it keeps the color users already recognize from the app.
const WHATSAPP_NUMBER = "5215529130187"
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`

const WhatsappFloatButton = () => {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chatea con nosotros por WhatsApp"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 small:bottom-6 small:right-6"
    >
      <FaWhatsapp className="h-7 w-7" />
    </a>
  )
}

export default WhatsappFloatButton
