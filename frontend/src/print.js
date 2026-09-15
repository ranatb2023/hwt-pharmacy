// Printing on two very different pieces of paper.
//
// The counter has a thermal roll; the office has A4. They are not one job with a
// different scale — a roll is 80mm wide with no page height at all, and the page
// SIZE cannot be chosen from a stylesheet class because `@page` does not accept
// one. So the rule is injected for the length of the print call and removed
// afterwards, which is the only way to switch paper without a second stylesheet.
//
// `afterprint` is not reliable everywhere, so the cleanup is also queued on a
// timer: leaving `printing-thermal` on the body would shrink the live screen to
// 72mm, which looks like the app has broken.

const STYLE_ID = 'hwt-print-page-rule';

const PAGE_RULES = {
  // A roll: fixed width, unlimited length, and margins close to nothing because
  // an 80mm roll only has about 72mm of printable width.
  thermal: '@page { size: 80mm auto; margin: 3mm; }',
  a4: '@page { size: A4; margin: 12mm; }',
};

function cleanup() {
  document.body.classList.remove('printing-modal', 'printing-thermal');
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

/**
 * Print the dialog that is currently open, on the paper asked for.
 *
 * @param {'a4'|'thermal'} paper
 * @param {{ modal?: boolean }} opts  modal: hide the page the dialog covers
 */
export function printPaper(paper = 'a4', opts = {}) {
  cleanup();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PAGE_RULES[paper] || PAGE_RULES.a4;
  document.head.appendChild(style);

  if (opts.modal !== false) document.body.classList.add('printing-modal');
  if (paper === 'thermal') document.body.classList.add('printing-thermal');

  const done = () => { cleanup(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);

  // The class has to be on the body before the browser snapshots the page, and
  // a paint has to happen in between or the first print goes out unstyled.
  requestAnimationFrame(() => {
    window.print();
    // Belt and braces: some browsers never fire afterprint.
    setTimeout(done, 1000);
  });
}
