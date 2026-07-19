import { registerCustomTheme, resolveTheme } from '@pierre/diffs'
import type { DiffsThemeNames, ThemeRegistrationResolved } from '@pierre/diffs'

// github-dark colors comments #8b949e — tuned for the plain #0d1117 editor
// background, not for diff rows tinted green/red. On addition rows (and worse,
// under word-level emphasis overlays) that gray lands around 3:1 contrast.
// This variant lifts only the comment foreground; everything else is stock.
const COMMENT_FOREGROUND = '#a5b4c2'

export const DARK_THEME = 'github-dark-readable-comments' as DiffsThemeNames

registerCustomTheme(DARK_THEME as string, async () => {
  const base = (await resolveTheme('github-dark' as string)) as ThemeRegistrationResolved
  const isCommentRule = (rule: { scope?: string | string[] }) => {
    const scopes = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : []
    return scopes.includes('comment')
  }
  const brighten = <T extends { scope?: string | string[]; settings?: { foreground?: string } }>(
    rules: T[] | undefined,
  ): T[] | undefined =>
    rules?.map((rule) =>
      isCommentRule(rule)
        ? { ...rule, settings: { ...rule.settings, foreground: COMMENT_FOREGROUND } }
        : rule,
    )
  // The resolved base theme is frozen — rebuild the parts we touch. Both
  // `tokenColors` (raw VSCode form) and `settings` (normalized form) may be
  // present depending on how the loader resolved it; rewrite whichever exist.
  return {
    ...base,
    name: DARK_THEME as string,
    displayName: 'GitHub Dark (readable comments)',
    tokenColors: brighten(base.tokenColors),
    settings: brighten(base.settings),
  } as ThemeRegistrationResolved
})
