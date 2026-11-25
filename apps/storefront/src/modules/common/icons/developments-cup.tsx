import React from "react"

import { clx } from "@modules/common/components/ui"

type DevelopmentsCupProps = React.SVGAttributes<SVGElement> & {
  /** Rendered height in px; width follows the artwork's aspect ratio. */
  size?: number
  color?: string
  /** Extra classes for the two sparkle groups (e.g. hover animations). */
  sparkleClassName?: string
}

const CUP_OUTLINE =
  "M0,-25.471C0.58,-24.775 0.712,-24.006 0.803,-23.217C0.904,-22.339 1.059,-21.465 1.135,-20.585C1.197,-19.875 1.245,-19.151 1.18,-18.444C0.741,-13.611 0.266,-8.781 -0.188,-3.949C-0.294,-2.821 -0.48,-1.698 -0.3,-0.553C-0.075,0.873 0.796,1.568 2.225,1.382C4.355,1.103 6.484,0.82 8.614,0.539C10.605,0.276 12.596,0.02 14.586,-0.25C15.716,-0.403 16.498,-1.267 16.413,-2.344C16.362,-2.995 16.261,-3.667 16.037,-4.277C14.305,-8.992 12.554,-13.699 10.776,-18.397C9.756,-21.09 9.275,-23.849 9.475,-26.72C6.399,-26.315 3.241,-25.898 0,-25.471ZM1.665,2.835C1.57,2.817 1.476,2.793 1.38,2.781C-0.193,2.596 -1.35,1.429 -1.625,-0.13C-1.897,-1.67 -1.636,-3.181 -1.495,-4.698C-1.068,-9.293 -0.611,-13.885 -0.191,-18.48C-0.13,-19.146 -0.17,-19.827 -0.233,-20.495C-0.326,-21.487 -0.49,-22.471 -0.609,-23.461C-0.689,-24.128 -0.99,-24.654 -1.531,-25.047C-1.702,-25.17 -1.914,-25.273 -2.019,-25.44C-2.149,-25.646 -2.292,-25.939 -2.234,-26.139C-2.177,-26.34 -1.901,-26.57 -1.684,-26.615C-1.013,-26.756 -0.325,-26.816 0.357,-26.906C3.823,-27.362 7.288,-27.818 10.754,-28.274C10.851,-28.287 10.949,-28.306 11.047,-28.306C11.591,-28.306 11.915,-27.777 11.648,-27.304C11.531,-27.098 11.374,-26.913 11.224,-26.728C10.802,-26.208 10.64,-25.622 10.746,-24.958C11.023,-23.23 11.069,-21.461 11.701,-19.796C12.636,-17.33 13.552,-14.858 14.476,-12.388C15.443,-9.799 16.436,-7.22 17.357,-4.615C17.614,-3.886 17.733,-3.084 17.775,-2.308C17.851,-0.9 16.973,0.354 15.663,0.889C15.561,0.931 15.463,0.983 15.363,1.03C10.797,1.632 6.231,2.234 1.665,2.835Z"

const CUP_LIQUID =
  "M0,9.666L-8.655,10.807C-9.967,10.98 -10.837,10.237 -10.735,8.906C-10.596,6.937 -10.387,4.968 -10.178,3.008C-10.106,2.305 -9.542,1.78 -8.838,1.661C-8.541,1.613 -8.244,1.566 -7.944,1.543C-7.583,1.522 -7.4,1.333 -7.307,0.983C-6.91,-0.474 -5.469,-1.314 -4.021,-0.915C-3.23,-0.699 -2.645,-0.204 -2.303,0.548C-2.229,0.712 -2.132,0.794 -1.946,0.822C-1.355,0.9 -0.939,1.227 -0.704,1.759C-0.656,1.865 -0.616,1.973 -0.575,2.08L0.852,5.939C0.96,6.229 1.067,6.518 1.167,6.817C1.266,7.107 1.358,7.407 1.432,7.709C1.695,8.715 1.038,9.521 0,9.666Z"

const SPARKLE_LARGE =
  "M-5.224,-5.224C-6.136,-1.65 -6.875,-0.912 -10.448,-0.001C-6.875,0.912 -6.136,1.649 -5.224,5.224C-4.313,1.649 -3.574,0.912 -0.001,-0.001C-3.574,-0.912 -4.313,-1.65 -5.224,-5.224Z"

const SPARKLE_SMALL =
  "M-3.228,-3.228C-3.792,-1.019 -4.248,-0.563 -6.457,-0C-4.248,0.563 -3.792,1.02 -3.228,3.228C-2.665,1.02 -2.208,0.563 -0,-0C-2.208,-0.563 -2.665,-1.019 -3.228,-3.228Z"

/** Drink cup with sparkles — the "Desarrollos" (custom beverage) mark. */
const DevelopmentsCup: React.FC<DevelopmentsCupProps> = ({
  size = 20,
  color = "currentColor",
  sparkleClassName,
  ...attributes
}) => {
  const sparkle = clx(
    "[transform-box:fill-box] [transform-origin:center]",
    sparkleClassName
  )

  return (
    <svg
      height={size}
      width={(size * 151) / 197}
      viewBox="0 0 151 197"
      xmlns="http://www.w3.org/2000/svg"
      fillRule="evenodd"
      clipRule="evenodd"
      strokeMiterlimit={10}
      {...attributes}
    >
      <g transform="translate(-1525.993445,-1570.869629) scale(4.166667)">
        <g transform="translate(373.3197,416.4832)">
          <path d={CUP_OUTLINE} fill={color} fillRule="nonzero" />
          <path
            d={CUP_OUTLINE}
            fill="none"
            stroke={color}
            strokeWidth={0.96}
          />
        </g>
        <g transform="translate(385.7876,404.9637)">
          <path
            d={CUP_LIQUID}
            fill={color}
            fillRule="nonzero"
            stroke={color}
            strokeWidth={0.74}
          />
        </g>
        <g transform="matrix(0,-1,-1,0,391.3236,377.8926)">
          <path
            className={sparkle}
            d={SPARKLE_LARGE}
            fill={color}
            stroke={color}
            strokeWidth={0.18}
            strokeLinecap="square"
          />
        </g>
        <g transform="matrix(0,-1,-1,0,398.4793,384.4982)">
          <path
            className={clx(sparkle, "[transition-delay:75ms]")}
            d={SPARKLE_SMALL}
            fill={color}
            stroke={color}
            strokeWidth={0.11}
            strokeLinecap="square"
          />
        </g>
      </g>
    </svg>
  )
}

export default DevelopmentsCup
