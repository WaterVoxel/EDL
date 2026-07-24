const dropzone = document.getElementById("dropzone");
const filepicker = document.getElementById("filepicker");
const fileGallery = document.getElementById("file-gallery");
const preview = document.getElementById("preview");
const previewInfo = document.getElementById("preview-info");
const outputList = document.getElementById("output-list");
const resultPreview = document.getElementById("result-preview");
const resultInfo = document.getElementById("result-info");
const downloadResult = document.getElementById("download-result");
const downloadStatus = document.getElementById("download-status");
const clearInputBtn = document.getElementById("clear-input");

let currentResultName = null;

const trimSource = document.getElementById("trim-source");
const holdSource = document.getElementById("hold-source");
const reverseSource = document.getElementById("reverse-source");
const spliceOrder = document.getElementById("splice-order");

let selectedSpliceOrder = []; // array of filenames in click order

// ---------- upload ----------

function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  return fetch("/api/upload", { method: "POST", body: fd })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) {
        alert("Upload failed: " + data.error);
      } else {
        previewFile(data.name, "input", preview, previewInfo);
      }
      refreshInputFiles();
    });
}

downloadResult.addEventListener("click", () => {
  if (!currentResultName) return;
  const name = currentResultName;
  downloadResult.disabled = true;
  downloadStatus.textContent = "Verifying file info before download…";

  fetch("/api/probe/" + encodeURIComponent(name) + "?dir=output")
    .then((r) => r.json())
    .then((freshInfo) => {
      if (freshInfo.error) {
        downloadStatus.textContent = "Could not verify file info: " + freshInfo.error;
        downloadResult.disabled = false;
        return;
      }
      // Re-render the panel from this same fresh probe so what's on screen
      // and what's about to download are guaranteed to be the same data.
      renderTechInfo(resultInfo, name, freshInfo);

      const link = document.createElement("a");
      link.href = "/output/" + encodeURIComponent(name);
      link.setAttribute("download", name);
      document.body.appendChild(link);
      link.click();
      link.remove();

      downloadStatus.textContent =
        `Downloaded "${name}" — matches: ${freshInfo.format_name || "?"}, ` +
        `${freshInfo.width}x${freshInfo.height}, ${freshInfo.fps ? freshInfo.fps.toFixed(2) : "?"} fps, ` +
        `${freshInfo.video_codec || "no video"}, ${freshInfo.audio_codec || "no audio"}` +
        (freshInfo.audio_codec
          ? ` @ ${freshInfo.audio_sample_rate || "?"} Hz / ${freshInfo.audio_channels || "?"}ch`
          : "") +
        `, ${freshInfo.bit_rate ? Math.round(freshInfo.bit_rate / 1000) + " kb/s" : "?"}.`;
      downloadResult.disabled = false;
    })
    .catch(() => {
      downloadStatus.textContent = "Could not verify file info — download not started.";
      downloadResult.disabled = false;
    });
});

clearInputBtn.addEventListener("click", () => {
  if (!confirm("Delete all files in input/? This cannot be undone.")) return;
  fetch("/api/clear_input", { method: "POST" }).then((r) => r.json()).then(() => {
    preview.removeAttribute("src");
    previewInfo.classList.remove("visible");
    previewInfo.innerHTML = "";
    refreshInputFiles();
  });
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const files = e.dataTransfer.files;
  for (const f of files) uploadFile(f);
});
filepicker.addEventListener("change", (e) => {
  for (const f of e.target.files) uploadFile(f);
  filepicker.value = "";
});

// ---------- file listing ----------

function refreshInputFiles() {
  fetch("/api/files")
    .then((r) => r.json())
    .then((files) => {
      renderFileList(fileGallery, files, (name) => previewFile(name, "input", preview, previewInfo));
      populateSelect(trimSource, files);
      populateSelect(holdSource, files);
      populateSelect(reverseSource, files);
      renderSpliceList(files);
    });
}

function refreshOutputFiles() {
  fetch("/api/outputs")
    .then((r) => r.json())
    .then((files) => {
      renderFileList(outputList, files, (name) => previewFile(name, "output", resultPreview, resultInfo, true));
    });
}

function previewFile(name, which, videoEl, infoEl, isResult) {
  const directUrl = "/" + which + "/" + encodeURIComponent(name);
  if (isResult) {
    currentResultName = name;
    downloadStatus.textContent = "";
  }
  fetch("/api/probe/" + encodeURIComponent(name) + "?dir=" + which)
    .then((r) => r.json())
    .then((info) => {
      if (info.browser_playable === false) {
        videoEl.src = "/preview/" + which + "/" + encodeURIComponent(name);
        showPreviewNote(videoEl, `Transcoding preview (source is ${info.video_codec || "an unsupported codec"}, not playable directly in browsers)…`);
      } else {
        videoEl.src = directUrl;
        clearPreviewNote(videoEl);
      }
      if (infoEl) renderTechInfo(infoEl, name, info);
      if (isResult) downloadResult.style.display = "inline-block";
    })
    .catch(() => {
      videoEl.src = directUrl; // fall back to direct URL if probe fails
      if (isResult) downloadResult.style.display = "inline-block";
    });
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(1) + " " + units[i];
}

function renderTechInfo(infoEl, name, info) {
  if (info.error) {
    infoEl.innerHTML = `<div class="warn">Could not read technical info: ${escapeHtml(info.error)}</div>`;
    infoEl.classList.add("visible");
    return;
  }
  const rows = [
    ["File", name],
    ["Format", info.format_name || "—"],
    ["Duration", info.duration ? info.duration.toFixed(3) + "s" : "—"],
    ["Resolution", info.width && info.height ? `${info.width}x${info.height}` : "—"],
    ["Frame rate", info.fps ? info.fps.toFixed(2) + " fps" : "—"],
    ["Frames", info.nb_frames != null ? info.nb_frames : "—"],
    ["Video codec", info.video_codec || "—"],
    ["Audio codec", info.audio_codec || (info.has_audio === false ? "none" : "—")],
    ["Audio sample rate", info.audio_sample_rate ? info.audio_sample_rate + " Hz" : "—"],
    ["Audio channels", info.audio_channels != null ? info.audio_channels : "—"],
    ["Bit rate", info.bit_rate ? Math.round(info.bit_rate / 1000) + " kb/s" : "—"],
    ["File size", formatBytes(info.size_bytes)],
    ["Browser playable", info.browser_playable === false
      ? '<span class="warn">no (transcoded for preview)</span>'
      : "yes"],
  ];
  infoEl.innerHTML =
    "<dl>" +
    rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") +
    "</dl>";
  infoEl.classList.add("visible");
}

function showPreviewNote(videoEl, text) {
  clearPreviewNote(videoEl);
  const note = document.createElement("div");
  note.className = "status-line preview-note";
  note.textContent = text;
  videoEl.insertAdjacentElement("afterend", note);
}

function clearPreviewNote(videoEl) {
  const existing = videoEl.nextElementSibling;
  if (existing && existing.classList.contains("preview-note")) {
    existing.remove();
  }
}

function renderFileList(ul, files, onClick) {
  ul.innerHTML = "";
  for (const f of files) {
    const li = document.createElement("li");
    li.textContent = f.name;
    li.addEventListener("click", () => {
      [...ul.children].forEach((c) => c.classList.remove("selected"));
      li.classList.add("selected");
      onClick(f.name);
    });
    ul.appendChild(li);
  }
}

function populateSelect(select, files) {
  const current = select.value;
  select.innerHTML = "";
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.name;
    opt.textContent = f.name;
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === current)) {
    select.value = current;
  }
}

function renderSpliceList(files) {
  spliceOrder.innerHTML = "";
  for (const f of files) {
    const li = document.createElement("li");
    li.textContent = f.name;
    const idx = selectedSpliceOrder.indexOf(f.name);
    if (idx !== -1) {
      li.textContent += "  (#" + (idx + 1) + ")";
      li.classList.add("selected");
    }
    li.addEventListener("click", () => {
      const i = selectedSpliceOrder.indexOf(f.name);
      if (i === -1) {
        selectedSpliceOrder.push(f.name);
      } else {
        selectedSpliceOrder.splice(i, 1);
      }
      renderSpliceList(files);
    });
    spliceOrder.appendChild(li);
  }
}

// ---------- trim ----------

document.getElementById("trim-run").addEventListener("click", () => {
  const body = {
    input: trimSource.value,
    start: document.getElementById("trim-start").value,
    end: document.getElementById("trim-end").value,
  };
  if (!body.input || !body.end) {
    alert("Select a source file and an end time.");
    return;
  }
  postJSON("/api/trim", body).then(handleEditResult);
});

// ---------- splice ----------

document.getElementById("splice-run").addEventListener("click", () => {
  if (selectedSpliceOrder.length < 2) {
    alert("Click at least 2 files (in the order you want them spliced).");
    return;
  }
  postJSON("/api/splice", { inputs: selectedSpliceOrder }).then((data) => {
    handleEditResult(data);
    selectedSpliceOrder = [];
    refreshInputFiles();
  });
});

// ---------- hold frame ----------

document.getElementById("hold-run").addEventListener("click", () => {
  const body = {
    input: holdSource.value,
    time: document.getElementById("hold-time").value,
    duration: document.getElementById("hold-duration").value,
  };
  if (!body.input || body.time === "" || body.duration === "") {
    alert("Select a source file, a time, and a duration.");
    return;
  }
  postJSON("/api/hold_frame", body).then(handleEditResult);
});

// ---------- reverse ----------

document.getElementById("reverse-run").addEventListener("click", () => {
  const warningBox = document.getElementById("reverse-warning");
  warningBox.style.display = "none";
  const input = reverseSource.value;
  if (!input) {
    alert("Select a source file.");
    return;
  }
  postJSON("/api/reverse", { input }).then((data) => {
    if (data.warning) {
      warningBox.textContent = data.warning + " Click Reverse again to confirm.";
      warningBox.style.display = "block";
      reverseSource.dataset.confirmPending = "1";
      const onceMore = () => {
        postJSON("/api/reverse", { input, confirm: true }).then(handleEditResult);
        document.getElementById("reverse-run").removeEventListener("click", onceMore);
      };
      document.getElementById("reverse-run").addEventListener("click", onceMore, { once: true });
      return;
    }
    handleEditResult(data);
  });
});

// ---------- shared helpers ----------

function postJSON(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function handleEditResult(data) {
  if (data.error) {
    alert("Error: " + data.error + (data.detail ? "\n\n" + data.detail : ""));
    return;
  }
  if (data.output) {
    refreshOutputFiles();
  }
}

// ---------- chat ----------

const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");

document.getElementById("chat-send").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

let chatSessionId = null;

document.getElementById("chat-new").addEventListener("click", () => {
  chatSessionId = null;
  chatLog.innerHTML = "";
});

function sendChat() {
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";

  const entry = document.createElement("div");
  entry.className = "chat-entry";
  entry.innerHTML = `<div><strong>You:</strong> ${escapeHtml(message)}</div><div class="status-line">thinking…</div>`;
  chatLog.appendChild(entry);
  chatLog.scrollTop = chatLog.scrollHeight;

  postJSON("/api/chat", { message, session_id: chatSessionId }).then((data) => {
    if (data.session_id) chatSessionId = data.session_id;
    renderChatResponse(entry, data);
  });
}

function renderChatResponse(entry, data) {
  const statusLine = entry.querySelector(".status-line");
  if (data.error) {
    statusLine.remove();
    const err = document.createElement("div");
    err.className = "error-text";
    err.textContent = "Error: " + data.error + (data.detail ? " — " + data.detail : "");
    entry.appendChild(err);
    return;
  }

  statusLine.remove();

  const explanation = document.createElement("div");
  explanation.textContent = data.explanation || "";
  entry.appendChild(explanation);

  if (data.needs_clarification) {
    const hint = document.createElement("div");
    hint.className = "status-line";
    hint.textContent = "Reply below to answer — I'll remember this conversation.";
    entry.appendChild(hint);
    return;
  }

  if (!data.valid) {
    if (data.ffmpeg_command) {
      const cmdBlock = document.createElement("pre");
      cmdBlock.textContent = data.ffmpeg_command;
      entry.appendChild(cmdBlock);
    }
    const err = document.createElement("div");
    err.className = "error-text";
    err.textContent = "This command was rejected (" + data.validation_error + ") — try rephrasing your request as a single ffmpeg edit.";
    entry.appendChild(err);
    return;
  }

  const cmdBlock = document.createElement("pre");
  cmdBlock.textContent = data.ffmpeg_command;
  entry.appendChild(cmdBlock);

  const runBtn = document.createElement("button");
  runBtn.textContent = "Run";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.marginLeft = "8px";

  runBtn.addEventListener("click", () => {
    runBtn.disabled = true;
    cancelBtn.disabled = true;
    const status = document.createElement("div");
    status.className = "status-line";
    status.textContent = "running…";
    entry.appendChild(status);

    postJSON("/api/execute", { command: data.ffmpeg_command }).then((res) => {
      status.remove();
      if (res.error) {
        const err = document.createElement("div");
        err.className = "error-text";
        err.textContent = "Execution failed: " + res.error + (res.detail ? " — " + res.detail : "");
        entry.appendChild(err);
      } else {
        const ok = document.createElement("div");
        ok.textContent = "Done.";
        entry.appendChild(ok);
        refreshOutputFiles();
      }
    });
  });

  cancelBtn.addEventListener("click", () => {
    runBtn.remove();
    cancelBtn.remove();
    const cancelled = document.createElement("div");
    cancelled.className = "status-line";
    cancelled.textContent = "Cancelled.";
    entry.appendChild(cancelled);
  });

  entry.appendChild(runBtn);
  entry.appendChild(cancelBtn);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------- refresh whole GUI ----------

document.getElementById("refresh-all").addEventListener("click", (e) => {
  e.target.classList.add("spinning");
  location.reload();
});

// ---------- init ----------

refreshInputFiles();
refreshOutputFiles();
