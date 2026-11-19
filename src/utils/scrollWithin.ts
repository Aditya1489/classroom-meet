/**
 * Scrolls the nearest scrollable container of `el` to its bottom, and nothing else.
 * element.scrollIntoView() also scrolls every ancestor, including the host page when the meeting is
 * embedded in an iframe, which made the whole course page jump when chat opened or a message arrived.
 */
export function scrollToBottomWithin(el: HTMLElement | null | undefined, behavior: ScrollBehavior = "smooth"): void {
  let box = el?.parentElement ?? null;
  while (box) {
    const overflowY = getComputedStyle(box).overflowY;
    if (/(auto|scroll)/.test(overflowY) && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  box?.scrollTo({ top: box.scrollHeight, behavior });
}
