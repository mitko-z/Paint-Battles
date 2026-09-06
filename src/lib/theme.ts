// "Battle Poster" direction - see the UI look-book comparison (lobby/match/results
// mockups) the team picked this from. Leans on the splash key art's palette: a dark
// torch-lit navy, the wordmark's paint-drip red/blue, and a warm gold rim-light accent.
//
// Token *names* are kept the same as the previous "editorial paper" theme (ink/paper/
// paperDeep/accent/accentDark/success/danger/white/overlay) even though the roles have
// flipped light->dark, so every screen that already reads colors.paper as "the screen
// background" and colors.ink as "the primary text color" keeps working unchanged -
// only the values needed to change here.
export const colors = {
  ink: "#F5EFE3", // primary text - warm parchment, not pure white
  inkMuted: "#C9BFA9",
  paper: "#1B2A3D", // primary screen background - dark torch-lit navy
  paperDeep: "#22354A", // panels/cards sitting on top of paper
  accent: "#D7263D", // paint-drip red - primary CTAs
  accentDark: "#8F1524", // pressed/bevel shade of accent
  gold: "#E8A33D", // rim-light gold - active states, badges, dividers
  blue: "#4A97CC", // paint-drip blue - secondary accent, used sparingly
  success: "#6E9B4F",
  canvas: "#FFFEF8", // the drawing surface itself - deliberately NOT reskinned; this is
  // the player's artwork, not chrome, and needs to stay a neutral, consistent working
  // surface no matter which direction the UI around it takes.
  stroke: "#1B1B1B",
  danger: "#C8362E",
  white: "#FFFFFF",
  overlay: "rgba(10, 16, 24, 0.8)",
};

export const fonts = {
  display: "PermanentMarker", // brush-marker headlines: brand title, win/lose, prompt text, scores
  body: "BarlowCondensed-Medium", // default UI text
  bodySemiBold: "BarlowCondensed-SemiBold", // buttons, labels
  bodyBold: "BarlowCondensed-Bold", // emphasis within body text
};
