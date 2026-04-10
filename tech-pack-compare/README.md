# Tech Pack Compare Skeleton

This version adds an **image analysis skeleton** on top of the existing text compare flow.

## What is new

- Browser renders selected PDF pages to PNG previews with PDF.js
- Frontend sends preview images to a new Netlify function: `analyze-techpack-images`
- New function prepares an image-based compare flow for future multimodal / vision support
- Current implementation includes a safe fallback response if image-capable analysis is not available yet

## Why this matters

Some buyer comments in apparel tech packs appear as marked-up sketches, arrows, circled areas, or image-based notes. Text extraction alone will miss those.

## Current flow

1. Upload PDF A and PDF B
2. Browser extracts text for text compare
3. Browser renders selected page(s) into PNG preview images using PDF.js canvas rendering
4. Frontend sends `imageA`, `imageB`, `pageA`, `pageB`, and `comments` to `/.netlify/functions/analyze-techpack-images`
5. Function returns a skeleton image-analysis result

## Current limitation

This is a scaffold, not a finished vision compare feature. The image function is prepared for future multimodal API connection, but currently uses a fallback path if the image-capable API request is not supported or configured.

## Relevant files

- `public/index.html`
- `public/app.js`
- `netlify/functions/analyze-techpack-images/index.js`
- `netlify/functions/compare-techpacks/index.js`
