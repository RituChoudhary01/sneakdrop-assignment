const API_BASE = "http://localhost:3000/api";

let currentHoldId = null;
let currentOrderId = null;
let countdownInterval = null;

const userSelect = document.getElementById("userId");
const buyButton = document.getElementById("buyButton");
const payButton = document.getElementById("payButton");

const successPaymentButton =
  document.getElementById("successPaymentButton");

const failedPaymentButton =
  document.getElementById("failedPaymentButton");

const pendingPaymentButton =
  document.getElementById("pendingPaymentButton");

const paymentActions =
  document.getElementById("paymentActions");

const message = document.getElementById("message");

const pairsLeft = document.getElementById("pairsLeft");
const purchasedCount = document.getElementById("purchasedCount");
const holdStatus = document.getElementById("holdStatus");
const countdown = document.getElementById("countdown");
const waitlistPosition =
  document.getElementById("waitlistPosition");

const holdCard = document.getElementById("holdCard");
const largeCountdown =
  document.getElementById("largeCountdown");

const waitlistCard =
  document.getElementById("waitlistCard");

const largeWaitlistPosition =
  document.getElementById("largeWaitlistPosition");


function getUserId() {
  return Number(userSelect.value);
}


function showMessage(text, type = "normal") {
  message.textContent = text;

  if (type === "success") {
    message.style.color = "green";
  } else if (type === "error") {
    message.style.color = "red";
  } else {
    message.style.color = "#666";
  }
}


function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}


async function loadStatus() {
  try {
    const userId = getUserId();

    const response = await fetch(
      `${API_BASE}/status/${userId}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Failed to load status"
      );
    }

    updateStatus(data);
  } catch (error) {
    console.error(error);
    showMessage(
      "Unable to connect to backend.",
      "error"
    );
  }
}


function updateStatus(data) {
  pairsLeft.textContent = data.pairsLeft ?? "-";
  purchasedCount.textContent =
    data.purchasedCount ?? 0;

  if (data.purchasedCount >= 2) {
    buyButton.disabled = true;
    buyButton.textContent =
      "Purchase Limit Reached";
  } else {
    buyButton.disabled = false;
    buyButton.textContent = "Buy Now";
  }


  if (data.hold) {
    currentHoldId = data.hold.id;
    currentOrderId = data.hold.orderId ?? null;

    holdStatus.textContent = "Active";

    holdCard.classList.remove("hidden");

    startCountdown(data.hold.expiresAt);

    /*
     * Payment buttons are visible only when
     * there is an actual pending order.
     */
    if (currentOrderId) {
      paymentActions.classList.remove("hidden");

      if (payButton) {
        payButton.classList.add("hidden");
      }
    } else {
      paymentActions.classList.add("hidden");
    }
  } else {
    currentHoldId = null;
    currentOrderId = null;

    holdStatus.textContent = "None";

    holdCard.classList.add("hidden");

    paymentActions.classList.add("hidden");

    if (payButton) {
      payButton.classList.add("hidden");
    }

    stopCountdown();

    countdown.textContent = "--:--";
    largeCountdown.textContent = "05:00";
  }


  if (data.waitlist) {
    waitlistPosition.textContent =
      `#${data.waitlist.position}`;

    largeWaitlistPosition.textContent =
      `#${data.waitlist.position}`;

    waitlistCard.classList.remove("hidden");
  } else {
    waitlistPosition.textContent = "-";

    largeWaitlistPosition.textContent = "#-";

    waitlistCard.classList.add("hidden");
  }
}


/*
 * BUY
 */
buyButton.addEventListener(
  "click",
  async () => {
    const userId = getUserId();

    buyButton.disabled = true;

    showMessage(
      "Processing...",
      "normal"
    );

    try {
      const response = await fetch(
        `${API_BASE}/buy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            userId
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Purchase failed"
        );
      }


      if (data.type === "HOLD_CREATED") {
        currentHoldId = data.holdId;
        currentOrderId = data.orderId;

        showMessage(
          "Your pair has been reserved for 5 minutes.",
          "success"
        );
      }


      else if (data.type === "ALREADY_HELD") {
        currentHoldId = data.holdId;
        currentOrderId = data.orderId;

        showMessage(
          "You already have an active hold.",
          "normal"
        );
      }


      else if (data.type === "WAITLISTED") {
        currentHoldId = null;
        currentOrderId = null;

        showMessage(
          `Sold out. You are #${data.position} in the waitlist.`,
          "normal"
        );
      }


      else if (data.type === "ALREADY_WAITING") {
        showMessage(
          `You are already #${data.position} in the waitlist.`,
          "normal"
        );
      }


      await loadStatus();

    } catch (error) {
      console.error(error);

      showMessage(
        error.message ||
          "Something went wrong.",
        "error"
      );
    } finally {
      buyButton.disabled = false;
    }
  }
);


/*
 * PAYMENT EVENT
 */
async function sendPaymentEvent(type) {
  if (!currentOrderId) {
    showMessage(
      "No active payment found.",
      "error"
    );

    return;
  }


  successPaymentButton.disabled = true;
  failedPaymentButton.disabled = true;
  pendingPaymentButton.disabled = true;


  showMessage(
    `Sending ${type} payment event...`,
    "normal"
  );


  try {
    const response = await fetch(
      `${API_BASE}/payment`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          orderId: currentOrderId,
          type,
          providerCreatedAt:
            new Date().toISOString()
        })
      }
    );


    const data = await response.json();


    if (!response.ok) {
      throw new Error(
        data.error ||
          "Payment request failed"
      );
    }


    if (
      type === "SUCCEEDED" &&
      data.outcome === "APPLIED"
    ) {
      showMessage(
        "Payment successful! Your sneaker is purchased.",
        "success"
      );
    }


    else if (
      data.outcome === "APPLIED_REVIVED"
    ) {
      showMessage(
        "Late payment accepted and order revived.",
        "success"
      );
    }


    else if (
      type === "FAILED" &&
      data.outcome === "APPLIED"
    ) {
      showMessage(
        "Payment failed. Your hold has been released.",
        "error"
      );
    }


    else if (type === "PENDING") {
      showMessage(
        "Payment is pending. Your hold is still active.",
        "normal"
      );
    }


    else if (
      data.outcome === "REFUND_REQUIRED"
    ) {
      showMessage(
        "Payment arrived too late. Refund is required.",
        "error"
      );
    }


    else if (
      data.outcome === "IGNORED_DUPLICATE"
    ) {
      showMessage(
        "Duplicate payment event ignored.",
        "normal"
      );
    }


    else if (
      data.outcome === "IGNORED_STALE"
    ) {
      showMessage(
        "Stale payment event ignored.",
        "normal"
      );
    }


    else if (
      data.outcome === "IGNORED_CONFLICT"
    ) {
      showMessage(
        "Conflicting payment event ignored.",
        "error"
      );
    }


    await loadStatus();

  } catch (error) {
    console.error(error);

    showMessage(
      error.message ||
        "Payment request failed.",
      "error"
    );
  } finally {
    successPaymentButton.disabled = false;
    failedPaymentButton.disabled = false;
    pendingPaymentButton.disabled = false;
  }
}


successPaymentButton.addEventListener(
  "click",
  () => sendPaymentEvent("SUCCEEDED")
);


failedPaymentButton.addEventListener(
  "click",
  () => sendPaymentEvent("FAILED")
);


pendingPaymentButton.addEventListener(
  "click",
  () => sendPaymentEvent("PENDING")
);


/*
 * COUNTDOWN
 */
function startCountdown(expiresAt) {
  stopCountdown();

  function update() {
    const expires =
      new Date(expiresAt).getTime();

    const now = Date.now();

    const secondsLeft = Math.max(
      0,
      Math.floor(
        (expires - now) / 1000
      )
    );

    countdown.textContent =
      formatTime(secondsLeft);

    largeCountdown.textContent =
      formatTime(secondsLeft);


    if (secondsLeft <= 0) {
      stopCountdown();

      showMessage(
        "Your hold has expired.",
        "error"
      );

      loadStatus();
    }
  }

  update();

  countdownInterval =
    setInterval(update, 1000);
}


function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);

    countdownInterval = null;
  }
}


/*
 * USER CHANGE
 */
userSelect.addEventListener(
  "change",
  async () => {
    stopCountdown();

    currentHoldId = null;
    currentOrderId = null;

    paymentActions.classList.add("hidden");

    showMessage("");

    await loadStatus();
  }
);


/*
 * AUTO REFRESH
 */
setInterval(() => {
  loadStatus();
}, 3000);


/*
 * INITIAL LOAD
 */
loadStatus();