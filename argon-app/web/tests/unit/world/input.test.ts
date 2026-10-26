// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Input } from "../../../src/world/engine/Input";
let input: Input;
afterEach(() => { input?.dispose(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
function setup() {
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  const look = vi.fn(), action = vi.fn(); input = new Input(canvas, look, action);
  return { canvas, look, action };
}
function key(code: string, repeat = false, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", {code, repeat, bubbles:true, cancelable:true}));
}
it("walks without pointer lock and clears held keys across blur", () => {
  setup(); key("KeyW"); expect(input.down("KeyW")).toBe(true);
  window.dispatchEvent(new Event("blur")); key("KeyW", true);
  expect(input.down("KeyW")).toBe(false);
  key("KeyW"); expect(input.down("KeyW")).toBe(true);
});
it("never takes WASD from text or contenteditable and clears previous movement", () => {
  setup(); key("KeyW");
  for (const tag of ["input", "textarea", "div"]) {
    const editor = document.createElement(tag); if(tag === "div") { editor.contentEditable = "true"; editor.setAttribute("contenteditable", "true"); editor.tabIndex = 0; }
    document.body.append(editor); editor.focus(); key("KeyD", false, editor);
    expect(input.down("KeyW")).toBe(false); expect(input.down("KeyD")).toBe(false);
    editor.remove();
  }
});
it("blocks modal movement but lets Escape close it; buttons do not trap WASD", () => {
  const {action} = setup();
  const modal=document.createElement("section"); modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); document.body.append(modal);
  key("KeyW"); expect(input.down("KeyW")).toBe(false); key("Escape"); expect(action).toHaveBeenCalledWith("Escape",true);
  modal.remove(); const button=document.createElement("button");document.body.append(button);button.focus(); key("KeyW",false,button);expect(input.down("KeyW")).toBe(true);
});
it("does not mouse-look on an unlocked drag or when pointer lock fails", () => {
  const {canvas,look}=setup();
  canvas.requestPointerLock = vi.fn(() => Promise.reject(new Error("denied")));
  canvas.dispatchEvent(new Event("pointerdown")); window.dispatchEvent(new MouseEvent("mousemove")); expect(look).not.toHaveBeenCalled();
});
