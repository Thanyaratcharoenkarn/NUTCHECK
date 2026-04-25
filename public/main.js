const checkButton = document.getElementById("checkButton");
const studentIdInput = document.getElementById("studentId");
const loader = document.getElementById("loader");
const result = document.getElementById("result");

async function checkIn() {
  const id = studentIdInput.value.trim();

  if (!id) {
    result.textContent = "กรุณากรอกรหัสนักเรียน";
    return;
  }

  checkButton.disabled = true;
  loader.hidden = false;
  result.textContent = "";

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id })
    });

    const data = await response.json();
    result.textContent = data.message;
  } catch (error) {
    result.textContent = "❌ ต่อเซิร์ฟเวอร์ไม่ได้";
  } finally {
    checkButton.disabled = false;
    loader.hidden = true;
  }
}

checkButton.addEventListener("click", checkIn);
studentIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    checkIn();
  }
});
