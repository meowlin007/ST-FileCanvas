// File Canvas — SillyTavern extension
// ให้ AI สร้าง/แก้ไฟล์ในแชท พร้อม preview + save เป็นไฟล์จริง (.json, .html, .txt, .js, .css, .md, .csv ฯลฯ)

import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { extension_settings, getContext } from "../../../extensions.js";

const MODULE_NAME = "file_canvas";

// ---------- ค่าเริ่มต้น ----------
const defaultSettings = {
  enabled: true,
  autoDetect: true, // ตรวจจับ code block อัตโนมัติแล้วโชว์ปุ่ม save
};

function loadSettings() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
  }
  for (const key of Object.keys(defaultSettings)) {
    if (extension_settings[MODULE_NAME][key] === undefined) {
      extension_settings[MODULE_NAME][key] = defaultSettings[key];
    }
  }
  return extension_settings[MODULE_NAME];
}

// ---------- helper: เดานามสกุลไฟล์จาก language ของ code block ----------
const LANG_TO_EXT = {
  json: "json",
  html: "html",
  htm: "html",
  xml: "xml",
  css: "css",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  python: "py",
  py: "py",
  markdown: "md",
  md: "md",
  txt: "txt",
  text: "txt",
  plaintext: "txt",
  csv: "csv",
  yaml: "yaml",
  yml: "yaml",
  sh: "sh",
  bash: "sh",
  shell: "sh",
  sql: "sql",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  php: "php",
  ruby: "rb",
  go: "go",
  rust: "rs",
};

function guessExtension(lang, content) {
  if (lang) {
    const key = lang.trim().toLowerCase();
    if (LANG_TO_EXT[key]) return LANG_TO_EXT[key];
  }
  // เดาแบบง่ายๆ จากเนื้อหา ถ้าไม่มี lang บอก
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch (e) {
      /* ไม่ใช่ json ก็ปล่อยผ่าน */
    }
  }
  if (/^<!DOCTYPE html>|<html[\s>]/i.test(trimmed)) return "html";
  return "txt";
}

function guessFilename(lang, content, index) {
  const ext = guessExtension(lang, content);
  return `file_canvas_${index}.${ext}`;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- popup preview ----------
function openPreviewPopup(filename, content, onSaveAs) {
  const overlay = document.createElement("div");
  overlay.className = "fc-overlay";

  const modal = document.createElement("div");
  modal.className = "fc-modal";

  const header = document.createElement("div");
  header.className = "fc-modal-header";

  const title = document.createElement("input");
  title.className = "fc-filename-input";
  title.value = filename;

  const closeBtn = document.createElement("button");
  closeBtn.className = "fc-btn fc-btn-icon";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => overlay.remove();

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement("textarea");
  body.className = "fc-modal-body";
  body.value = content;
  body.spellcheck = false;

  const footer = document.createElement("div");
  footer.className = "fc-modal-footer";

  const copyBtn = document.createElement("button");
  copyBtn.className = "fc-btn";
  copyBtn.textContent = "คัดลอก";
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(body.value);
    copyBtn.textContent = "คัดลอกแล้ว ✓";
    setTimeout(() => (copyBtn.textContent = "คัดลอก"), 1200);
  };

  const saveBtn = document.createElement("button");
  saveBtn.className = "fc-btn fc-btn-primary";
  saveBtn.textContent = "💾 บันทึกไฟล์";
  saveBtn.onclick = () => {
    downloadFile(title.value || filename, body.value);
    if (onSaveAs) onSaveAs(title.value, body.value);
  };

  footer.appendChild(copyBtn);
  footer.appendChild(saveBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// ---------- เพิ่มปุ่ม save ใต้ code block แต่ละอัน ----------
function attachButtonsToMessage(messageEl) {
  if (!messageEl || messageEl.dataset.fcProcessed === "1") return;

  const pres = messageEl.querySelectorAll("pre > code");
  if (pres.length === 0) return;

  let index = 0;
  pres.forEach((codeEl) => {
    const pre = codeEl.parentElement;
    if (pre.dataset.fcDone === "1") return;
    pre.dataset.fcDone = "1";
    index += 1;

    const content = codeEl.innerText;
    // ข้ามบล็อกสั้นเกินไป (โค้ดตัวอย่าง 1 บรรทัด ไม่ต้องมีปุ่ม)
    if (content.trim().split("\n").length < 2 && content.length < 40) return;

    const langMatch = [...codeEl.classList]
      .map((c) => c.replace("language-", ""))
      .find((c) => c && c !== "hljs");

    const filename = guessFilename(langMatch, content, index);

    const toolbar = document.createElement("div");
    toolbar.className = "fc-toolbar";

    const nameSpan = document.createElement("span");
    nameSpan.className = "fc-filename";
    nameSpan.textContent = filename;

    const previewBtn = document.createElement("button");
    previewBtn.className = "fc-mini-btn";
    previewBtn.textContent = "👁 ดู";
    previewBtn.onclick = () => openPreviewPopup(filename, content);

    const saveBtn = document.createElement("button");
    saveBtn.className = "fc-mini-btn fc-mini-btn-primary";
    saveBtn.textContent = "💾 บันทึก";
    saveBtn.onclick = () => downloadFile(filename, content);

    toolbar.appendChild(nameSpan);
    toolbar.appendChild(previewBtn);
    toolbar.appendChild(saveBtn);

    pre.parentElement.insertBefore(toolbar, pre);
  });

  messageEl.dataset.fcProcessed = "1";
}

function scanAllMessages() {
  document.querySelectorAll("#chat .mes").forEach((mes) => {
    // อนุญาตให้สแกนซ้ำได้เผื่อมีข้อความ stream เพิ่มเข้ามา
    mes.dataset.fcProcessed = "0";
    attachButtonsToMessage(mes);
  });
}

// ---------- แนบไฟล์อัปโหลดให้ AI แก้ไข ----------
// เพิ่มปุ่มใน toolbar ล่างช่องพิมพ์ ให้อัปโหลดไฟล์แล้วแนบเนื้อหาเข้าไปในข้อความที่จะส่ง
let attachedFile = null; // { name, content }

function buildUploadUI() {
  const wrap = document.getElementById("send_form") || document.getElementById("form_sheld");
  if (!wrap || document.getElementById("fc_upload_wrap")) return;

  const container = document.createElement("div");
  container.id = "fc_upload_wrap";
  container.className = "fc-upload-wrap";

  const label = document.createElement("label");
  label.className = "fc-upload-label";
  label.title = "แนบไฟล์ให้ AI แก้ไข";
  label.textContent = "📎";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.json,.html,.htm,.css,.js,.md,.csv,.xml,.yaml,.yml,.py,.sh,.sql";
  input.style.display = "none";

  const badge = document.createElement("span");
  badge.className = "fc-upload-badge";
  badge.style.display = "none";

  const clearBtn = document.createElement("span");
  clearBtn.className = "fc-upload-clear";
  clearBtn.textContent = "✕";
  clearBtn.style.display = "none";
  clearBtn.onclick = () => {
    attachedFile = null;
    badge.style.display = "none";
    clearBtn.style.display = "none";
    input.value = "";
  };

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    attachedFile = { name: file.name, content: text };
    badge.textContent = `📄 ${file.name}`;
    badge.style.display = "inline-block";
    clearBtn.style.display = "inline-block";
  });

  label.appendChild(input);
  label.addEventListener("click", (e) => {
    if (e.target === input) return;
    input.click();
  });

  container.appendChild(label);
  container.appendChild(badge);
  container.appendChild(clearBtn);

  // แทรกไว้ข้างปุ่มส่งข้อความ
  const sendBtn = document.getElementById("send_but");
  if (sendBtn && sendBtn.parentElement) {
    sendBtn.parentElement.insertBefore(container, sendBtn);
  } else {
    wrap.appendChild(container);
  }
}

// ก่อนส่งข้อความ: ถ้ามีไฟล์แนบ ให้ต่อเนื้อหาไฟล์เข้ากับข้อความผู้ใช้
function injectAttachedFileIntoMessage() {
  if (!attachedFile) return;
  const textarea = document.getElementById("send_textarea");
  if (!textarea) return;

  const fenceLang = guessExtension(null, attachedFile.content);
  const block = `\n\n[ไฟล์แนบ: ${attachedFile.name}]\n\`\`\`${fenceLang}\n${attachedFile.content}\n\`\`\`\n`;
  textarea.value = (textarea.value || "") + block;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  // เคลียร์หลังใช้ครั้งเดียว
  attachedFile = null;
  const badge = document.querySelector(".fc-upload-badge");
  const clearBtn = document.querySelector(".fc-upload-clear");
  if (badge) badge.style.display = "none";
  if (clearBtn) clearBtn.style.display = "none";
}

// ---------- init ----------
jQuery(async () => {
  loadSettings();

  // ปุ่ม/toolbar สำหรับอัปโหลดไฟล์
  buildUploadUI();

  // เมื่อกดปุ่มส่ง ให้แนบไฟล์ (ถ้ามี) เข้าไปก่อน
  const sendBtn = document.getElementById("send_but");
  if (sendBtn) {
    sendBtn.addEventListener("click", injectAttachedFileIntoMessage, true);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && document.activeElement?.id === "send_textarea") {
      injectAttachedFileIntoMessage();
    }
  }, true);

  // สแกนข้อความใหม่ทุกครั้งที่ AI ตอบเสร็จ / มีการ render ใหม่
  eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(scanAllMessages, 50));
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(scanAllMessages, 50));
  eventSource.on(event_types.USER_MESSAGE_RENDERED, () => setTimeout(scanAllMessages, 50));
  eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(scanAllMessages, 100));
  if (event_types.STREAM_TOKEN_RECEIVED) {
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => setTimeout(scanAllMessages, 50));
  }

  // สแกนครั้งแรกตอนโหลด
  setTimeout(scanAllMessages, 500);
});
