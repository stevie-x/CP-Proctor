function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }
  
  function renderEvents(events) {
    const container = document.getElementById("events");
    container.innerHTML = "";
  
    if (events.length === 0) {
      container.innerHTML = "<p>No events yet.</p>";
      return;
    }
  
    // Show latest events first
    [...events].reverse().forEach((event) => {
      const div = document.createElement("div");
      div.className = `event ${event.type}`;
      div.innerHTML = `
        <strong>${event.type}</strong>
        <span class="time"> — ${formatTime(event.timestamp)}</span>
        <div>${JSON.stringify(event.data)}</div>
      `;
      container.appendChild(div);
    });
  }
  
  // Load and display events
  chrome.storage.local.get(["events"], (result) => {
    renderEvents(result.events || []);
  });
  
  // Clear button
  document.getElementById("clear").addEventListener("click", () => {
    chrome.storage.local.set({ events: [] });
    renderEvents([]);
  });