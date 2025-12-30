---
theme: buttondown
---

# Icons with Iconify

mdforge supports 200,000+ icons from [Iconify](https://iconify.design/).

## Basic Usage

Format: `:icon[set:icon-name]`

| Icon | Syntax |
|------|--------|
| :icon[mdi:home] | `:icon[mdi:home]` |
| :icon[mdi:cog] | `:icon[mdi:cog]` |
| :icon[mdi:star] | `:icon[mdi:star]` |
| :icon[ph:check-circle-fill] | `:icon[ph:check-circle-fill]` |

## Icon Sets

Popular icon sets:

- **mdi** - Material Design Icons (7000+ icons)
- **ph** - Phosphor Icons
- **lucide** - Lucide Icons
- **heroicons** - Heroicons
- **tabler** - Tabler Icons

Browse all at [icon-sets.iconify.design](https://icon-sets.iconify.design/)

## With Sizes

Use `{size=N}` to set pixel size:

| Size | Example | Syntax |
|------|---------|--------|
| 16px | :icon[mdi:heart]{size=16} | `:icon[mdi:heart]{size=16}` |
| 24px | :icon[mdi:heart]{size=24} | `:icon[mdi:heart]{size=24}` |
| 32px | :icon[mdi:heart]{size=32} | `:icon[mdi:heart]{size=32}` |
| 48px | :icon[mdi:heart]{size=48} | `:icon[mdi:heart]{size=48}` |

## Inline in Text

Icons work inline: Click :icon[mdi:home]{size=16} to go home, or :icon[mdi:cog]{size=16} for settings.

## Practical Examples

### Feature List

- :icon[mdi:check-circle]{size=18} Easy to use
- :icon[mdi:check-circle]{size=18} Thousands of icons
- :icon[mdi:check-circle]{size=18} Cached locally

### Contact Info

:icon[mdi:email]{size=16} contact@example.com
:icon[mdi:phone]{size=16} +1 234 567 890
:icon[mdi:map-marker]{size=16} 123 Main Street

### Status Indicators

| Status | Icon |
|--------|------|
| Success | :icon[mdi:check-circle]{size=20} |
| Warning | :icon[mdi:alert]{size=20} |
| Error | :icon[mdi:close-circle]{size=20} |
| Info | :icon[mdi:information]{size=20} |

## Notes

- Icons are fetched from Iconify API and cached in `~/.cache/mdforge/icons/`
- First run may be slower while icons are downloaded
- Subsequent runs use cached icons
