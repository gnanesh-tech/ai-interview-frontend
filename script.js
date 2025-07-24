let sessionId = "";
let candidateName = "";
let candidateEmail = "";

const SERVER_URL = "https://ai-interview-backend-bzpz.onrender.com";

let questions = [];
let currentQuestionIndex = 0;
let mediaRecorder;
let recordedChunks = [];
let conversation = "";
let interimElement = null;

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = false;
recognition.interimResults = true;
recognition.lang = 'en-US';

document.getElementById("candidateForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  candidateName = document.getElementById("name").value.trim();
  candidateEmail = document.getElementById("email").value.trim();
  sessionId = `${candidateName}_${Date.now()}`.replace(/\s+/g, "_");

  // Hide form and auto-click start
  document.getElementById("candidateForm").style.display = "none";
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("startBtn").click();
});

window.addEventListener("load", async () => {
  try {
    const res = await fetch(`${SERVER_URL}/questions`);
    questions = await res.json();
  } catch (err) {
    alert("Failed to load questions.");
    console.error(err);
  }
});

document.getElementById("startBtn").addEventListener("click", async () => {
  if (questions.length === 0) {
    alert("Interview questions not loaded.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("preview").srcObject = stream;

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const textBlob = new Blob([conversation], { type: "text/plain" });

      const formData = new FormData();
      formData.append("name", candidateName);
      formData.append("email", candidateEmail);
      formData.append("sessionId", sessionId);
      formData.append("video", blob, "interview_video.webm");
      formData.append("transcript", textBlob, "interview_transcript.txt");

      try {
        const res = await fetch(`${SERVER_URL}/upload`, {
          method: "POST",
          body: formData,
        });
        const msg = await res.text();
        alert(msg);
      } catch (err) {
        alert("Upload failed.");
        console.error(err);
      }
    };

    mediaRecorder.start();
    currentQuestionIndex = 0;
    askQuestionAndListen(currentQuestionIndex);

  } catch (err) {
    alert("Failed to access camera/microphone.");
    console.error(err);
  }
});

function askQuestionAndListen(index) {
  if (index >= questions.length) {
    mediaRecorder.stop();
    return;
  }

  const question = questions[index];
  conversation += `AI: ${question}\n`;
  appendMessage("ai", question);

  const utterance = new SpeechSynthesisUtterance(question);
  utterance.onend = () => {
    recognition.start();
  };

  recognition.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
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

  recognition.onerror = () => {
    conversation += `Candidate: [No response]\n\n`;
    appendMessage("user", "[No response]");
    recognition.stop();
    setTimeout(() => askQuestionAndListen(currentQuestionIndex + 1), 1500);
  };

  speechSynthesis.speak(utterance);
}

function appendMessage(sender, text) {
  const chat = document.getElementById("chatContainer");
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message", sender === "ai" ? "ai" : "user");
  msgDiv.textContent = text;
  chat.appendChild(msgDiv);
  chat.scrollTop = chat.scrollHeight;
}
