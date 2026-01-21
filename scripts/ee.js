import { fromEds } from './from-eds.js';

// Wrap all experience-element blocks in a structure that fromEds expects
const wrapper = document.createElement('div');
const main = document.querySelector('main');
const blocks = Array.from(main.querySelectorAll('.experience-element'))
  .map((block) => {
    const html = block.outerHTML;
    return html;
  })
  .join('');
wrapper.innerHTML = `<body><header></header><main>${blocks}</main></body>`;
main.innerHTML = '<sp-theme system="spectrum-two" color="light" scale="medium"></sp-theme>';

// Convert the EDS block to custom element markup
const customElementHtml = fromEds(wrapper.innerHTML);

// Parse the result and get the custom element
const parser = new DOMParser();
const doc = parser.parseFromString(customElementHtml, 'text/html');
const customElement = doc.body.firstElementChild;

// Insert the custom element into the DOM
main.firstElementChild.appendChild(customElement);
