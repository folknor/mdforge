---
theme: beryl
---

# Form Fields

mdforge supports form fields for creating fillable PDF documents using marked-forms syntax.

## Syntax Reference

| Type | Syntax | Description |
|------|--------|-------------|
| Text | `[Label ??](name)` | Single-line text input |
| Textarea | `[Label ???](name)` | Multi-line text area (4 lines default) |
| Textarea | `[Label ???6](name)` | Multi-line text area (6 lines) |
| Select | `[?select? Label](name)` + list | Dropdown (fillable) or radio (default) |
| Radio | `[?radiolist? Label](name)` + list | Single choice |
| Checkbox | `[?checklist? Label](name)` + list | Multiple choices |


## Text Inputs

Basic text input with a label:

[Full Name ??](fullName)

Text input without a label:

[??](anonymous)

## Textarea

Use three question marks for multi-line text areas:

[Comments ???](comments)

Textarea with specific line count (6 lines):

[Bio ???6](bio)

## Select Dropdown

Create a dropdown by following the field declaration with a list. In default mode, selects render as radio buttons since static dropdowns aren't interactive. In fillable mode (`--fillable`), they become real dropdown menus:

[?select? Country](country)
- United States
- Canada
- United Kingdom
- Australia
- Other

Another select example:

[?select? Preferred Language](language)
- English
- Spanish
- French
- German

## Radio Buttons

Radio buttons for single-choice selections:

[?radiolist? Payment Method](payment)
- Credit Card
- PayPal
- Bank Transfer

Another radio example:

[?radiolist? Shipping Speed](shipping)
- Standard (5-7 days)
- Express (2-3 days)
- Overnight

## Checkboxes

Checkboxes allow multiple selections:

[?checklist? Interests](interests)
- Technology
- Design
- Business
- Marketing

Another checkbox example:

[?checklist? Features](features)
- Dark Mode
- Notifications
- Auto-save

## Custom Values

List items can have display text and a separate value in quotes:

[?select? Size](size)
- Small "S"
- Medium "M"
- Large "L"
- Extra Large "XL"

[?radiolist? Priority](priority)
- Low Priority "low"
- Normal Priority "normal"
- High Priority "high"
- Urgent "urgent"

## Complete Example: Event Registration

### Attendee Information

[First Name ??](firstName)

[Last Name ??](lastName)

[Email Address ??](emailAddress)

[Company ??](company)

[Job Title ??](jobTitle)

### Event Preferences

[?radiolist? Ticket Type](ticketType)
- General Admission "$99"
- VIP Access "$199"
- Virtual Only "$49"

[?select? T-Shirt Size](tshirtSize)
- Small "S"
- Medium "M"
- Large "L"
- X-Large "XL"
- XX-Large "XXL"

[?checklist? Sessions of Interest](sessions)
- Keynote Presentations
- Technical Workshops
- Networking Events
- Panel Discussions

[?radiolist? Dietary Requirements](dietary)
- No restrictions
- Vegetarian
- Vegan
- Gluten-free
- Other (specify below)

### Additional Information

[Special requests or accessibility needs ???](specialRequests)

[?checklist? Communication Preferences](commPrefs)
- Email updates about this event
- Future event announcements
- Partner offers
