let sessionId = "";  
let candidateName = "";
let candidateEmail = "";
let micStream = null;


document.getElementById("candidateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  candidateName = document.getElementById("name").value.trim();
  candidateEmail = document.getElementById("email").value.trim();
  sessionId = `${candidateName}_${Date.now()}`.replace(/\s+/g, "_");

  document.getElementById("candidateForm").style.display = "none";
  document.getElementById("startBtn").style.display = "block"; // Allow user to click
});




const SERVER_URL = "https://ai-interview-backend-bzpz.onrender.com";
let recognitionTimeout = null;

const urlParams = new URLSearchParams(window.location.search);
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
  if (questions.length === 0) {
    alert("Interview questions not loaded yet.");
    return;
  }

  micStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
      recordedChunks.push(e.data);
      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      store.add(e.data);
    }
  };

  mediaRecorder.onstop = async () => {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const textBlob = new Blob([conversation], { type: 'text/plain' });

  try {
    await uploadToServer(blob, textBlob);
    alert("Interview uploaded successfully!");
  } catch (err) {
    console.error("Upload failed:", err);
    alert("Upload to server failed.");
  }
  if (micStream) {
  micStream.getTracks().forEach(track => track.stop());
  }


  const clearTx = db.transaction("chunks", "readwrite");
  const clearStore = clearTx.objectStore("chunks");
  clearStore.clear();
};


  currentQuestionIndex = 0;
  mediaRecorder.start();
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
  recognition.onerror = () => {
  clearTimeout(recognitionTimeout); 
  handleNoResponseFallback();
};

};

function recoverPreviousRecording() {
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
        uploadToServer(recoveredBlob, new Blob(["Recovered session"], { type: 'text/plain' }));

        const clearTx = db.transaction("chunks", "readwrite");
        const clearStore = clearTx.objectStore("chunks");
        clearStore.clear();
      }
    }
  };
}

async function uploadToServer(videoBlob, textBlob) {
  const formData = new FormData();
  formData.append("name", candidateName);  
  formData.append("email", candidateEmail);
  formData.append("video", videoBlob, "interview_video.webm");
  formData.append("transcript", textBlob, "interview_transcript.txt");
  formData.append("sessionId", sessionId);

  try {
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const result = await response.text();
    console.log("Upload response:", result);
    alert("Interview uploaded successfully!");
  } catch (err) {
    console.error("Upload failed:", err);
    alert("Upload to server failed.");
  }
}

