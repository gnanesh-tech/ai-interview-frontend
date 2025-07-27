let sessionId = "";  
let candidateName = "";
let candidateEmail = "";
let isRecovering = false;


document.getElementById("candidateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  candidateName = document.getElementById("name").value.trim();
  candidateEmail = document.getElementById("email").value.trim();

  sessionId = `${candidateName}_${Date.now()}`.replace(/\s+/g, "_");


  document.getElementById("candidateForm").style.display = "none";
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("startBtn").click();  

});



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

startButton.addEventListener("click", async () => {
  if (!candidateName || !candidateEmail || !sessionId) {
    alert("Missing candidate details.");
    return;
  }
  if (!db) {
    alert("IndexedDB not initialized yet. Please wait a moment and try again.");
    return;
  }

  // ✅ Create FormData and POST to /start-session
  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("name", candidateName);
  formData.append("email", candidateEmail);

  try {
    const res = await fetch(`${SERVER_URL}/start-session`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      throw new Error("Failed to start session");
    }
  } catch (err) {
    console.error("❌ Error initializing session:", err);
    alert("Could not start session on the server.");
    return;
  }

  // ✅ Continue recording logic
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

      uploadChunkToServer(chunk);  // ✅ uses correct sessionId + name + email
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
  mediaRecorder.start();
} catch (err) {
  console.error("MediaRecorder start failed:", err);
  alert("Recording could not start. Please try again.");
  return;
}

  askQuestionAndListen(currentQuestionIndex);
});


function askQuestionAndListen(index) {
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
        
        isRecovering = true;  // 🔁 prevent mediaRecorder.onstop logic
        uploadToServer(recoveredBlob, new Blob(["Recovered session"], { type: 'text/plain' }));

        const clearTx = db.transaction("chunks", "readwrite");
        const clearStore = clearTx.objectStore("chunks");
        clearStore.clear();
      }
    }
  };
}


function uploadChunkToServer(chunk) {
  const formData = new FormData();
  formData.append("chunk", chunk, "chunk.webm");
  formData.append("sessionId", sessionId);
  formData.append("name", candidateName);      // ✅ added
  formData.append("email", candidateEmail);    // ✅ added

  fetch(`${SERVER_URL}/upload-chunk`, {
    method: "POST",
    body: formData,
  })
  .then(res => res.text())
  .then(data => console.log("Chunk uploaded"))
  .catch(err => console.error("Chunk upload failed:", err));
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

async function uploadToServer(videoBlob, transcriptBlob) {
  const formData = new FormData();
  formData.append("video", videoBlob, "interview.webm");
  formData.append("transcript", transcriptBlob, "transcript.txt");
  formData.append("sessionId", sessionId);
  formData.append("name", candidateName);
  formData.append("email", candidateEmail);

  const response = await fetch(`${SERVER_URL}/upload-final`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to upload final video and transcript.");
  }

  console.log("✅ Final video and transcript uploaded.");
}



