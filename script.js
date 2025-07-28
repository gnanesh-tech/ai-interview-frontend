let sessionId = "";  
let candidateName = "";
let candidateEmail = "";
let isRecovering = false;
let isWaitingForReconnect = false;
let disconnectTimer = null;





document.getElementById("candidateForm").addEventListener("submit", async (e) => {
  e.preventDefault();

   candidateName = document.getElementById("name").value.trim();
   candidateEmail = document.getElementById("email").value.trim();

  if (!candidateName || !candidateEmail) {
    alert("Please enter both name and email.");
    return;
  }

   sessionId = `${candidateName}_${Date.now()}`.replace(/\s+/g, "_");

  
  localStorage.setItem("candidateName", candidateName);
  localStorage.setItem("candidateEmail", candidateEmail);
  localStorage.setItem("sessionId", sessionId);

  document.getElementById("candidateForm").style.display = "none";
  document.getElementById("startBtn").style.display = "inline-block";


  console.log("Calling startInterview with:", candidateName, candidateEmail, sessionId);

  setTimeout(() => {
  startInterview(candidateName, candidateEmail, sessionId);
}, 1000);  

});


async function startInterview(name, email, sessionId) {
  if (!name || !email || !sessionId) {
    alert("Missing candidate details. Please fill the form again.");
    return;
  }

  const formData = new FormData();
  formData.append("name", name);
  formData.append("email", email);
  formData.append("sessionId", sessionId);

  try {
    const response = await fetch(`${SERVER_URL}/start-session`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Backend Error:", errorData);
      alert("Failed to start session. Please try again.");
      return;
    }

    const data = await response.json();
    console.log(" Session started:", data);

  } catch (error) {
    console.error("Error starting interview:", error);
    alert("Error connecting to server.");
  }
}


const SERVER_URL = "https://ai-interview-backend-bzpz.onrender.com";
let recognitionTimeout = null;

//const urlParams = new URLSearchParams(window.location.search);
//const sessionId = urlParams.get("sessionId") || "anonymous_" + Date.now();

function appendMessage(sender, text) {
  const chat = document.getElementById("chatContainer");
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message", sender === "ai" ? "ai" : "user");
  msgDiv.textContent = text;
  chat.appendChild(msgDiv);
  chat.scrollTop = chat.scrollHeight;
}

let questions = [];
let db;
let currentQuestionIndex = 0; 

window.addEventListener("load", () => {

  candidateName = localStorage.getItem("candidateName") || "";
  candidateEmail = localStorage.getItem("candidateEmail") || "";
  sessionId = localStorage.getItem("sessionId") || "";
  fetch(`${SERVER_URL}/questions`)

    .then(res => res.json())
    .then(data => {
      questions = data;
    })
    .catch(err => {
      console.error("Failed to load questions:", err);
      alert("Could not load questions from server.");
    });

  const openRequest = indexedDB.open("RecordingDB", 1);
  openRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("chunks")) {
      db.createObjectStore("chunks", { autoIncrement: true });
    }
  };
  openRequest.onsuccess = (e) => {
    db = e.target.result;
    const tx = db.transaction("chunks", "readonly");
    const store = tx.objectStore("chunks");
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      if (getAll.result.length > 0) {
        if (confirm("Previous interview session was interrupted. Recover?")) {
          recoverPreviousRecording();
        }
      }
    };
  };
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.interimResults = true;
recognition.lang = 'en-US';

let mediaRecorder;
let recordedChunks = [];
let conversation = "";
let audioCtx;
let destinationStream;
let interimElement = null;

const startButton = document.getElementById("startBtn");
const preview = document.getElementById("preview");

window.addEventListener('offline', () => {
  console.warn(" Internet disconnected");
  handleInternetLoss();
});

window.addEventListener('online', () => {
  console.log(" Internet reconnected");
  if (isWaitingForReconnect) {
    clearTimeout(disconnectTimer);
    resumeInterviewAfterReconnect();
  }
});


startButton.addEventListener("click", async () => {
  if (!candidateName || !candidateEmail || !sessionId) {
    alert("Missing candidate details.");
    return;
  }
  if (!db) {
    alert("IndexedDB not initialized yet. Please wait a moment and try again.");
    return;
  }

  

  
  if (questions.length === 0) {
    alert("Interview questions not loaded yet.");
    return;
  }

  const micStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  preview.srcObject = micStream;

  audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();
  destinationStream = destination.stream;

  const micSource = audioCtx.createMediaStreamSource(micStream);
  micSource.connect(destination);

  const combinedStream = new MediaStream([
    ...micStream.getVideoTracks(),
    ...destinationStream.getAudioTracks()
  ]);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(combinedStream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      const chunk = e.data;
      recordedChunks.push(chunk);
      if (!db) {
    alert("IndexedDB not ready. Cannot recover previous session.");
    return;
    }

      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      store.add(chunk);

      uploadChunkToServer(chunk);  
    }
  };

  mediaRecorder.onstop = async () => {
    if (isRecovering) return;
    notifyInterviewComplete(); 
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const textBlob = new Blob([conversation], { type: 'text/plain' });

    try {
      await uploadToServer(blob, textBlob);
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload to server failed.");
    }

    const clearTx = db.transaction("chunks", "readwrite");
    const clearStore = clearTx.objectStore("chunks");
    clearStore.clear();
  };

  currentQuestionIndex = 0;
  try {
  mediaRecorder.start(5000);
} catch (err) {
  console.error("MediaRecorder start failed:", err);
  alert("Recording could not start. Please try again.");
  return;
}

  askQuestionAndListen(currentQuestionIndex);
});


function askQuestionAndListen(index) {
  if (isWaitingForReconnect) {
    console.warn("⏸ Waiting for internet reconnect. Pausing question...");
    return;
  }

  if (index >= questions.length) {
    mediaRecorder.stop();
    return;
  }

  currentQuestionIndex = index;
  const question = questions[index];
  conversation += `AI: ${question}\n`;

  appendMessage("ai", question);

  const utterance = new SpeechSynthesisUtterance(question);
  utterance.onend = () => {
    if (isWaitingForReconnect) return; 

    recognition.start();

    recognitionTimeout = setTimeout(() => {
      recognition.stop();
      handleNoResponseFallback();
    }, 6000);
  };

  speechSynthesis.speak(utterance);
}


recognition.onresult = (event) => {
  clearTimeout(recognitionTimeout); 

  let finalTranscript = "";
  let interimTranscript = "";

  for (let i = event.resultIndex; i < event.results.length; ++i) {
    const transcript = event.results[i][0].transcript;

    if (event.results[i].isFinal) {
      finalTranscript += transcript + " ";
      conversation += `Candidate: ${transcript}\n\n`;

      appendMessage("user", transcript);

      if (interimElement) {
        interimElement.remove();
        interimElement = null;
      }

      recognition.stop();
      setTimeout(() => askQuestionAndListen(currentQuestionIndex + 1), 1500);
    } else {
      interimTranscript += transcript;
    }
  }

  if (interimTranscript) {
    if (!interimElement) {
      interimElement = document.createElement("div");
      interimElement.classList.add("message", "user");
      interimElement.style.opacity = "0.6";
      document.getElementById("chatContainer").appendChild(interimElement);
    }
    interimElement.textContent = interimTranscript;
  }
};

function handleNoResponseFallback() {
  conversation += `Candidate: [No response]\n\n`;

  appendMessage("user", "[No response]");
  setTimeout(() => askQuestionAndListen(currentQuestionIndex + 1), 1500);
}


recognition.onerror = () => {
  
  clearTimeout(recognitionTimeout); 
  handleNoResponseFallback();


};

function recoverPreviousRecording() {
  if (!db) {
    alert("IndexedDB not ready. Cannot recover previous session.");
    return;
  }
  const tx = db.transaction("chunks", "readonly");
  const store = tx.objectStore("chunks");
  const allChunks = [];

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      allChunks.push(cursor.value);
      cursor.continue();
    } else {
      if (allChunks.length > 0) {
        const recoveredBlob = new Blob(allChunks, { type: 'video/webm' });
        const recoveredURL = URL.createObjectURL(recoveredBlob);
        
        isRecovering = true;  
        candidateName = localStorage.getItem("candidateName") || "Unknown";
        candidateEmail = localStorage.getItem("candidateEmail") || "Unknown";
        sessionId = localStorage.getItem("sessionId") || `unknown_${Date.now()}`;
        uploadToServer(recoveredBlob, new Blob(["Recovered session"], { type: 'text/plain' }), candidateName, candidateEmail, sessionId);



        const clearTx = db.transaction("chunks", "readwrite");
        const clearStore = clearTx.objectStore("chunks");
        clearStore.clear();
      }
    }
  };
}


function uploadChunkToServer(chunk) {
  const sid = localStorage.getItem("sessionId");
  const name = localStorage.getItem("candidateName");
  const email = localStorage.getItem("candidateEmail");

  if (!sid || !name || !email) {
    console.warn(" Skipping chunk: Missing session or candidate info");
    return;
  }

  const formData = new FormData();
  formData.append("chunk", chunk, "chunk.webm");
  formData.append("sessionId", sid);
  formData.append("name", name);
  formData.append("email", email);

  fetch(`${SERVER_URL}/upload-chunk`, {
    method: "POST",
    body: formData,
  })
    .then(res => res.text())
    .then(data => console.log(" Chunk uploaded"))
    .catch(err => console.error(" Chunk upload failed:", err));
}


function notifyInterviewComplete() {
  fetch(`${SERVER_URL}/mark-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })
  .then(res => res.text())
  .then(data => console.log("Interview marked complete."))
  .catch(err => console.error("Error marking complete:", err));
}

function handleInternetLoss() {
  if (!mediaRecorder || mediaRecorder.state !== "recording" || isWaitingForReconnect) return;

  mediaRecorder.pause();
  alert(" Internet disconnected! You have 2 minutes to reconnect before your interview ends.");

  isWaitingForReconnect = true;
  disconnectTimer = setTimeout(() => {
    alert(" Internet not restored in time. Uploading partial interview...");
    mediaRecorder.stop();  
    isWaitingForReconnect = false;
  }, 2 * 60 * 1000); 
}

function resumeInterviewAfterReconnect() {
  alert(" Internet reconnected. Resuming interview.");
  isWaitingForReconnect = false;

  if (mediaRecorder && mediaRecorder.state === "paused") {
    mediaRecorder.resume();
  }

  setTimeout(() => {
    askQuestionAndListen(currentQuestionIndex);
  }, 1000); 
}




async function uploadToServer(videoBlob, transcriptBlob, customName = candidateName, customEmail = candidateEmail, customSessionId = sessionId) {
  const formData = new FormData();
  formData.append("video", videoBlob, "interview.webm");
  formData.append("transcript", transcriptBlob, "transcript.txt");
  formData.append("sessionId", customSessionId);
  formData.append("name", customName);
  formData.append("email", customEmail);

  try {
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const resultText = await response.text();
    console.log(" Server response:", resultText);

    if (!response.ok) {
      console.error(" Upload failed with status", response.status);
      alert("Upload failed. Server said: " + resultText);
      return;
    }

    console.log(" Final video and transcript uploaded.");
    alert(" Interview uploaded successfully!");

  } catch (err) {
    console.error(" Upload failed due to network or crash:", err);
    alert("Upload to server failed due to error: " + err.message);
  }
}




