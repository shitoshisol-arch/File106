import { render } from './html.js';

export const HTML = 'text/html; charset=utf-8';

export function sendPage(reply, fragment, code = 200) {
  return reply.code(code).type(HTML).send(render(fragment));
}

export function redirect(reply, location, code = 303) {
  return reply.code(code).header('location', location).send();
}
