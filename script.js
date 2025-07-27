let sessionId = null;
let chunkIndex = 0;

 
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
  sessionId = `${candidateName}_${Date.now()}`;

  
  const formData = new FormData();
  formData.append("name", candidateName);
  formData.append("email", candidateEmail);
  formData.append("sessionId", sessionId);
  formData.append("transcript", transcript);

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

async function fetchTranscript(question, attempt = 1) {
  const maxAttempts = 5;
  const delay = 2000; // 2 seconds between tries

  const response = await fetch("/transcribe", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, question }),
    headers: { "Content-Type": "application/json" }
  });

  const data = await response.json();
  
  if (data.transcript && data.transcript.trim() !== "") {
    showMessage(data.transcript, "user");
  } else {
    if (attempt < maxAttempts) {
      console.log(`⏳ Retrying transcript... (Attempt ${attempt})`);
      setTimeout(() => {
        fetchTranscript(question, attempt + 1);
      }, delay);
    } else {
      showMessage("[No response]", "user");
    }
  }
}


window.addEventListener("offline", () => {
  alert("Internet disconnected. Interview paused. Recording will resume when you're back online.");

  if (mediaRecorder?.state === "recording") {
    mediaRecorder.pause(); 
  }

  disconnectTimer = setTimeout(() => {
    if (!navigator.onLine && mediaRecorder?.state !== "inactive") {
      mediaRecorder.stop();
      alert("Internet didn’t return in 2 mins. Interview saved partially.");
    }
  }, 2 * 60 * 1000);
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

  const combinedStream = micStream; // includes both audio and video tracks


  mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' });




  mediaRecorder.ondataavailable = async (e) => {
  if (e.data.size > 0) {
    const formData = new FormData();
    formData.append("videoBlob", e.data, `chunk-${Date.now()}.webm`);
    formData.append("name", candidateName);
    formData.append("email", candidateEmail);
    formData.append("sessionId", sessionId); 
    formData.append("index", chunkIndex);    

    chunkIndex++;

    try {
      await fetch("/upload-chunk", {
        method: "POST",
        body: formData,
      });
      console.log(" Chunk uploaded");

      
      if (wasOffline) {
        wasOffline = false;
        clearTimeout(offlineTimer);
        if (mediaRecorder.state === "paused") {
          mediaRecorder.resume();
          console.log(" Internet restored. Resumed recording.");
        }
      }

    } catch (err) {
      console.warn(" Chunk upload failed (maybe offline)", err);

      if (!wasOffline) {
        wasOffline = true;
        offlineStartTime = Date.now();

        
        if (mediaRecorder && mediaRecorder.state === "recording") {
          mediaRecorder.pause();
          console.log("⏸ Paused recording due to internet loss.");
        }

        
        offlineTimer = setTimeout(() => {
          if (!navigator.onLine) {
            console.log("⏱️ 2 minutes passed without internet. Stopping recorder.");
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
              mediaRecorder.stop(); 
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
  await fetchTranscript(currentQuestionIndex);

  setTimeout(() => {
    if (currentQuestionIndex + 1 < questions.length) {
      currentQuestionIndex++;
      askQuestionAndListen(currentQuestionIndex);
    } else {
      finalizeInterview(); // Now called reliably
    }
  }, 1500);
};


async function finalizeInterview() {
  alert("Interview completed. Uploading your data...");

  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("name", candidateName);
  formData.append("email", candidateEmail);
  const transcriptBlob = new Blob([conversation], { type: "text/plain" });
  formData.append("transcript", transcriptBlob, "interview_transcript.txt");


  try {
  const response = await fetch(`${SERVER_URL}/finalize-session`, {
    method: "POST",
    body: formData
  });

  if (response.ok) {
    console.log("✅ Session finalized successfully.");
    
    alert("🎉 Interview uploaded successfully!");
    document.getElementById("chatContainer").innerHTML += `
      <div class='message ai'>✅ Interview Uploaded Successfully</div>
    `;
  } else {
    console.warn("⚠️ Finalize session failed:", await response.text());
  }
} catch (err) {
  console.error("❌ Error finalizing session:", err);
}


}

  currentQuestionIndex = 0;
  

askQuestionAndListen(currentQuestionIndex);

});

let isFinalizing = false;

function askQuestionAndListen(index) {
  if (index >= questions.length) {
    if (!isFinalizing && mediaRecorder && mediaRecorder.state !== "inactive") {
      isFinalizing = true;
      mediaRecorder.stop(); // triggers mediaRecorder.onstop
    } else if (!isFinalizing) {
      finalizeInterview();
      isFinalizing = true;
    }
    return;
  }

  currentQuestionIndex = index;
  const question = questions[index];
  conversation += `AI: ${question}\n`;
  appendMessage("ai", question);

  const utterance = new SpeechSynthesisUtterance(question);
  utterance.onend = () => {
    let hasSpoken = false;

    try {
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition error on start:", err);
    }

    recognition.onresult = function (event) {
      let fullTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        fullTranscript += event.results[i][0].transcript;
      }

      const transcript = fullTranscript.trim();
      if (transcript) {
        hasSpoken = true;
        appendMessage("user", transcript);
        conversation += `Candidate: ${transcript}\n\n`;
        recognition.stop();

        setTimeout(() => {
          askQuestionAndListen(index + 1);
        }, 1000);
      }
    };

    recognition.onerror = function (event) {
      console.warn("Speech recognition error:", event.error);
      recognition.stop(); // let onend handle fallback
    };

    recognition.onend = function () {
      if (!hasSpoken) {
        appendMessage("user", "[No response]");
        conversation += `Candidate: [No response]\n\n`;
        askQuestionAndListen(index + 1);
      }
    };
  };

  speechSynthesis.speak(utterance);
}



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

window.addEventListener("beforeunload", async (e) => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();

    
    const transcriptBlob = new Blob([conversation], { type: "text/plain" });

    const formData = new FormData();
    formData.append("name", candidateName);
    formData.append("email", candidateEmail);
    formData.append("sessionId", sessionId);
    formData.append("transcript", transcriptBlob, "interview_transcript.txt");

    try {
      await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      console.log("Transcript uploaded on tab close.");
    } catch (err) {
      console.warn("Failed to upload transcript before unload:", err);
    }

    const message = "Interview is being saved. Please wait a few seconds...";
    e.returnValue = message;
    return message;
  }
});





