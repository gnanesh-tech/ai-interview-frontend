let sessionId = "";  
let wasOffline = false;
let offlineStartTime = null;
let offlineTimer = null;

let candidateName = "";
let candidateEmail = "";
let micStream = null;
let silenceTimer = null;
let recordedChunks = [];




document.getElementById("candidateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  candidateName = document.getElementById("name").value.trim();
  candidateEmail = document.getElementById("email").value.trim();
  sessionId = `${candidateName}_${Date.now()}`.replace(/\s+/g, "_");

  
  const formData = new FormData();
  formData.append("name", candidateName);
  formData.append("email", candidateEmail);
  formData.append("sessionId", sessionId);

  try {
    await fetch(`${SERVER_URL}/start-session`, {
      method: "POST",
      body: formData
    });
    console.log("Session started successfully.");
  } catch (err) {
    console.error("Failed to start session:", err);
    alert("Could not start the session. Try again.");
  }

  document.getElementById("candidateForm").style.display = "none";
  document.getElementById("startBtn").style.display = "block"; 
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

  
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US';

let mediaRecorder;

let conversation = "";
let audioCtx;
let destinationStream;
let interimElement = null;
let isSpeechRecognitionWorking = true; 
let disconnectTimer = null;

window.addEventListener("offline", () => {
  alert("Internet disconnected. Interview paused. Responses won't be transcribed until reconnection.");

  if (mediaRecorder?.state === "recording") {
    mediaRecorder.pause();
  }

  disconnectTimer = setTimeout(() => {
    if (!navigator.onLine) {
      alert("Internet not restored. Finalizing with available chunks...");

      if (mediaRecorder?.state !== "inactive") {
        mediaRecorder.stop();
      }
    }
  }, 2 * 60 * 1000);
});



window.addEventListener("beforeunload", (e) => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
});


window.addEventListener("online", () => {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  alert("Internet reconnected.");

  if (mediaRecorder?.state === "paused") {
    mediaRecorder.resume();
  }

  if (mediaRecorder?.state === "inactive" && recordedChunks.length > 0) {
    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const textBlob = new Blob([conversation], { type: 'text/plain' });

    uploadToServer(videoBlob, textBlob);
    alert("Uploading your interview now...");
    recordedChunks = [];
  }
});


const startButton = document.getElementById("startBtn");
const preview = document.getElementById("preview");

startButton.addEventListener("click", async () => {
  if (questions.length === 0) {
    alert("Interview questions not loaded yet.");
    return;
  }

  try {
  micStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
} catch (err) {
  alert("Access to camera or microphone denied.");
  return;
}

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

  mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' });



  mediaRecorder.ondataavailable = async (e) => {
  if (e.data.size > 0) {
    const formData = new FormData();
    formData.append("videoBlob", e.data, `chunk-${Date.now()}.webm`);
    formData.append("name", candidateName);
    formData.append("email", candidateEmail);

    try {
      await fetch("/upload-chunk", {
        method: "POST",
        body: formData,
      });
      console.log("✅ Chunk uploaded");

      // 🟢 If previously offline, and now online
      if (wasOffline) {
        wasOffline = false;
        clearTimeout(offlineTimer);
        if (mediaRecorder.state === "paused") {
          mediaRecorder.resume();
          console.log("🔄 Internet restored. Resumed recording.");
        }
      }

    } catch (err) {
      console.warn("🚫 Chunk upload failed (maybe offline)", err);

      if (!wasOffline) {
        wasOffline = true;
        offlineStartTime = Date.now();

        // ⏸ Pause the recording immediately
        if (mediaRecorder && mediaRecorder.state === "recording") {
          mediaRecorder.pause();
          console.log("⏸ Paused recording due to internet loss.");
        }

        // ⏳ Wait for 2 minutes
        offlineTimer = setTimeout(() => {
          if (!navigator.onLine) {
            console.log("⏱️ 2 minutes passed without internet. Stopping recorder.");
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
              mediaRecorder.stop(); // triggers upload of saved chunks
              alert("Internet didn’t return. Your partial video has been saved.");
            }
          }
        }, 2 * 60 * 1000);
      }
    }
  }
};


mediaRecorder.start(5000); 


  mediaRecorder.onstop = async () => {
  try {
    await fetch(`${SERVER_URL}/finalize-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: candidateName,
        email: candidateEmail,
        transcript: conversation
      })
    });

    alert("Interview uploaded successfully!");
  } catch (err) {
    console.error("Finalization failed:", err);
    alert("Could not complete the interview upload.");
  }

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
  }
};



  currentQuestionIndex = 0;
  

askQuestionAndListen(currentQuestionIndex);

});

let isFinalizing = false;

function askQuestionAndListen(index) {
  if (isFinalizing || index >= questions.length) {
    if (!isFinalizing && mediaRecorder && mediaRecorder.state !== "inactive") {
      isFinalizing = true;
      mediaRecorder.stop();
    }
    return;
  }

  if (index >= questions.length) {
    alert("Interview completed. Uploading your data...");
    mediaRecorder.stop();
    return;
  }

  currentQuestionIndex = index;

  const question = questions[index];
  conversation += `AI: ${question}\n`;
  appendMessage("ai", question);

  const utterance = new SpeechSynthesisUtterance(question);
  utterance.onend = () => {
  if (isSpeechRecognitionWorking) {
    try {
    recognition.start();
  } catch (err) {
    console.warn("Speech recognition could not start:", err);
}


    recognitionTimeout = setTimeout(() => {
      recognition.stop();  
      handleNoResponseFallback();
    }, 5000); 
  } else {
    
    const fallbackDuration = 15; 
    let remainingTime = fallbackDuration;

    const countdownEl = document.getElementById("countdownTimer");
    countdownEl.style.display = "block";
    countdownEl.textContent = `⏳ You have ${remainingTime} seconds to answer...`;

    const countdownInterval = setInterval(() => {
      remainingTime--;
      countdownEl.textContent = `⏳ Time left: ${remainingTime} seconds...`;

      if (remainingTime <= 0) {
        clearInterval(countdownInterval);
        countdownEl.style.display = "none";
        conversation += `Candidate: [Spoken during offline, not transcribed]\n\n`;
        askQuestionAndListen(currentQuestionIndex + 1);
      }
    }, 1000); 
  }
};


  speechSynthesis.speak(utterance);
}



recognition.onresult = (event) => {
  let finalTranscript = "";
  let interimTranscript = "";

  clearTimeout(silenceTimer);  

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

  
  silenceTimer = setTimeout(() => {
    recognition.stop();
    setTimeout(() => askQuestionAndListen(currentQuestionIndex + 1), 1500);
  }, 3000); 
};


function handleNoResponseFallback() {
  conversation += `Candidate: [No response]\n\n`;
  appendMessage("user", "[No response]");
  setTimeout(() => askQuestionAndListen(currentQuestionIndex + 1), 1500);
}


recognition.onerror = (event) => {
  clearTimeout(recognitionTimeout);

  if (event.error === "network" || event.error === "not-allowed") {
    isSpeechRecognitionWorking = false;
    console.warn("Speech recognition stopped due to network or permission issue.");
  }

  handleNoResponseFallback();
};




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



