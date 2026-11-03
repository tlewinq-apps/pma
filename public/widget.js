(function () {
  var s = document.currentScript; var key = s && s.getAttribute("data-project"); if (!key) return;
  var host = new URL(s.src).origin;
  // PMA look: grey ink on white, rounded corners, hairlines, a small blue tile as the mark.
  var INK = "#262b33", BLUE = "#2753be", SANS = "Manrope,system-ui,sans-serif";
  var btn = document.createElement("button");
  btn.innerHTML = '<span aria-hidden="true" style="width:9px;height:9px;background:#fbf9f4;border-radius:3px"></span>Feedback';
  btn.setAttribute("style", "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;padding:10px 14px 10px 12px;border:0;border-radius:10px;background:" + BLUE + ";color:#fff;font:600 13px " + SANS + ";cursor:pointer");
  var panel = document.createElement("div");
  panel.setAttribute("style", "display:none;position:fixed;right:16px;bottom:64px;z-index:2147483647;box-sizing:border-box;width:300px;padding:14px;border:1px solid rgba(38,43,51,.16);border-radius:14px;background:#fff;color:" + INK + ";font:13px " + SANS);
  panel.innerHTML = '<div style="margin-bottom:8px;font:600 18px \'Fraunces\',Georgia,serif;letter-spacing:-.02em">What could be better here?</div><textarea maxlength="5000" style="box-sizing:border-box;width:100%;height:96px;border-radius:8px;border:1px solid rgba(38,43,51,.22);background:#fff;color:' + INK + ';padding:8px;font:inherit"></textarea><button style="margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:' + BLUE + ';color:#fff;font:600 13px ' + SANS + ';cursor:pointer">Send</button><div data-msg style="margin-top:6px;color:#5a626e"></div>';
  btn.onclick = function () { panel.style.display = panel.style.display === "none" ? "block" : "none"; };
  panel.querySelector("button").onclick = function () {
    var ta = panel.querySelector("textarea"); var msg = panel.querySelector("[data-msg]");
    if (!ta.value.trim()) return;
    fetch(host + "/api/widget/feedback?key=" + encodeURIComponent(key), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ta.value, route: location.pathname + location.search, user: (window.PMAUser || null) }) })
      .then(function (r) { msg.textContent = r.ok ? "Thanks — sent." : "Could not send."; if (r.ok) ta.value = ""; })
      .catch(function () { msg.textContent = "Could not send."; });
  };
  // Snippet may sit in <head>, where document.body is still null: mount once the DOM is parsed.
  function mount() { document.body.appendChild(panel); document.body.appendChild(btn); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
