---
theme: pandoc
---

# Admonitions

mdforge supports Python-Markdown style admonitions for callout boxes.

## Basic Syntax

```
!!! note
    This is a note admonition.
    Content must be indented with 4 spaces or a tab.
```

## Admonition Types

!!! note
    **Note** - General information or remarks.

!!! tip
    **Tip** - Helpful suggestions or best practices.

!!! info
    **Info** - Additional context or background.

!!! warning
    **Warning** - Important cautions to be aware of.

!!! danger
    **Danger** - Critical warnings about potential problems.

!!! important
    **Important** - Key information that shouldn't be missed.

!!! success
    **Success** - Positive outcomes or confirmations.

!!! failure
    **Failure** - Error conditions or things that went wrong.

!!! bug
    **Bug** - Known issues or defects.

!!! example
    **Example** - Sample code or demonstrations.

!!! quote
    **Quote** - Citations or referenced material.

!!! question
    **Question** - FAQs or things to consider.

## Custom Titles

Override the default title with quoted text:

!!! warning "Watch Out!"
    You can provide a custom title in quotes after the type.

!!! note "Did You Know?"
    Custom titles let you be more specific about the content.

## No Title

Use empty quotes for no title:

!!! danger ""
    This admonition has no title bar, just the colored content area.

## Rich Content

Admonitions support full markdown inside:

!!! tip "Formatting Works"
    You can use **bold**, *italic*, and `code` inside admonitions.

    - Bullet lists work
    - Multiple items too

    ```python
    # Even code blocks!
    print("Hello from an admonition")
    ```

## Practical Examples

!!! warning "Before You Begin"
    Make sure you have backed up your data before proceeding with the installation.

!!! tip "Pro Tip"
    Use `Ctrl+Shift+P` to open the command palette quickly.

!!! note "Compatibility"
    This feature requires version 2.0 or higher.
