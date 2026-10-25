"""Pinned cua-sandbox 0.9.1 source-shape regression tests. No SDK boot or network."""
from types import SimpleNamespace
import pytest
from foundry_kernel.computers.cua_client import SdkComputer, BOOTSTRAP

async def test_native_screen_mouse_keyboard_and_shell_shapes():
    calls = []
    async def shot(): return b"png"
    async def click(x, y, button="left"): calls.append(("click", x, y, button))
    async def double(x, y): calls.append(("double", x, y))
    async def scroll(x, y, scroll_y=3): calls.append(("scroll", scroll_y))
    async def type_text(text): calls.append(("type", text))
    async def keypress(keys): calls.append(("keys", keys))
    async def run(command, timeout=30):
        calls.append(("shell", command, timeout))
        return SimpleNamespace(stdout="ok", stderr="", returncode=0)
    async def destroy(): calls.append(("destroy",))
    sb = SimpleNamespace(screen=SimpleNamespace(screenshot=shot), mouse=SimpleNamespace(click=click,double_click=double,scroll=scroll),
                         keyboard=SimpleNamespace(type=type_text,keypress=keypress), shell=SimpleNamespace(run=run), destroy=destroy)
    computer = SdkComputer("test", sb)
    assert await computer.screenshot() == b"png"
    await computer.click(10, 20)
    await computer.click(10, 20, double=True)
    await computer.scroll(240)
    await computer.type_text("test")
    await computer.key("ctrl+l")
    assert await computer.shell("true", timeout_s=5) == (0, "ok")
    await computer.stop()
    assert calls == [("click",10,20,"left"),("double",10,20),("scroll",-2),("type","test"),("keys",["ctrl","l"]),("shell","true",5),("destroy",)]
    assert "xclip" in BOOTSTRAP

async def test_viewer_failure_preserves_screenshot_fallback():
    async def unavailable(): raise RuntimeError("provider unavailable")
    c = SdkComputer("test", SimpleNamespace(viewer_url=unavailable))
    await c.refresh_watch_url()
    assert c.watch_url is None

async def test_spaces_attaches_existing_only_and_disconnects(settings, monkeypatch):
    import sys
    from foundry_kernel.computers import cua_client
    calls = []
    async def shot(): return b"png"
    async def current(): return "https://example.com"
    async def viewer(): return "http://127.0.0.1:3211/viewer"
    sb = SimpleNamespace(screenshot=shot,get_current_url=current,viewer_url=viewer)
    class Context:
        async def __aenter__(self): return sb
        async def __aexit__(self,*args): calls.append("disconnect")
    class Sandbox:
        @staticmethod
        def connect(name, local=True):
            calls.append(("connect",name,local))
            return Context()
        @staticmethod
        def ephemeral(*args,**kwargs): raise AssertionError("must not provision")
    monkeypatch.setattr(cua_client,"cua_available",lambda: (True,"test"))
    monkeypatch.setitem(sys.modules,"cua_sandbox",SimpleNamespace(Sandbox=Sandbox,Image=object))
    monkeypatch.setenv("CUA_SPACE_ID","existing-space")
    computer = await cua_client.create_computer(settings.model_copy(update={"cua_mode":"spaces"}),"agent")
    assert computer.id == "existing-space" and computer.watch_url == "http://127.0.0.1:3211/viewer"
    await computer.stop()
    assert calls == [("connect","existing-space",True),"disconnect"]
