export const ImgCountX = 8 // Horizontal frame count
export const ImgCountY = 5 // Vertical frame count
export const OutPutSizeX = 1440 // Physical lenticular display width
export const OutPutSizeY = 2560 // Physical lenticular display height
export const SubWidth = 450 // Single-view render width
export const SubHeight = 800 // Single-view render height

export const ViewCount = ImgCountX * ImgCountY
export const AtlasWidth = ImgCountX * SubWidth
export const AtlasHeight = ImgCountY * SubHeight

export const LenticularOptics = {
  slope: -0.2692,
  interval: 19.6401,
  x0: 0.10516,
  thetaDeg: 40,
}
