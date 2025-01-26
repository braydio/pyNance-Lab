document.addEventListener("DOMContentLoaded", () => {
  const institutionsContainer = document.getElementById("institutions-container");
  const searchBar = document.getElementById("search-bar");
  const linkButton = document.getElementById("link-button");
  const statusContainer = document.getElementById("status");
  const lastRefreshElement = document.getElementById("last-refresh-time");

  // Utility to fetch data from an endpoint
  function fetchData(url, options = {}) {
      return fetch(url, options)
          .then((response) => response.json())
          .catch((error) => {
              console.error(`Error fetching data from ${url}:`, error);
              throw error;
          });
  }

  // Plaid Link functionality
  function initializePlaidLink() {
    fetchData("/get_link_token")
      .then((data) => {
        if (data.link_token) {
          const handler = Plaid.create({
            token: data.link_token,
            onSuccess: function (public_token, metadata) {
              console.log("Public Token:", public_token);
              alert("Public Token: " + public_token);

              // Save the public token and fetch access token
              fetchData("/save_public_token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ public_token: public_token }),
              })
                .then((response) => {
                  if (response.access_token) {
                    console.log("Access Token:", response.access_token);
                    statusContainer.textContent = "Access token received!";
                  } else {
                    console.error("Error saving public token:", response.error);
                    statusContainer.textContent = "Failed to save public token.";
                  }
                })
                .catch((error) => {
                  console.error("Error saving public token:", error);
                  statusContainer.textContent = "An error occurred during the linking process.";
                });
            },
            onExit: function (err, metadata) {
              if (err) {
                console.error("Plaid Link error:", err);
                statusContainer.textContent = "User exited with an error.";
              } else {
                statusContainer.textContent = "User exited without error.";
              }
            },
          });

          linkButton.onclick = () => handler.open();
        } else {
          console.error("Error fetching link token:", data.error);
          statusContainer.textContent = "Error fetching link token.";
        }
      })
      .catch((error) => {
        console.error("Error initializing Plaid Link:", error);
        statusContainer.textContent = "Error initializing Plaid Link.";
      });
  }

  // Fetch institutions and render them
  function fetchAndRenderInstitutions() {
    fetchData("/get_institutions")
      .then((data) => {
        if (data.status === "success") {
          renderInstitutions(data.institutions);

          // Find the most recent refresh time across all institutions
          const mostRecentRefresh = Object.values(data.institutions).reduce(
            (latest, institution) => {
              const lastUpdate = institution.last_successful_update;

              // Check if the last update is a valid date
              if (lastUpdate && lastUpdate !== "Never refreshed") {
                const parsedDate = new Date(lastUpdate);
                return !isNaN(parsedDate) && parsedDate > latest ? parsedDate : latest;
              }
              return latest;
            },
            new Date(0) // Default to the earliest possible date
          );

          // Update the last refresh time in the UI
          lastRefreshElement.textContent =
            mostRecentRefresh > new Date(0)
              ? `Most Recent Refresh: ${mostRecentRefresh.toLocaleString()}`
              : "Never refreshed";
        } else {
          institutionsContainer.innerHTML = `<p>Error loading institutions: ${data.message}</p>`;
          lastRefreshElement.textContent = "Not available";
        }
      })
      .catch((error) => {
        institutionsContainer.innerHTML = `<p>Error loading institutions: ${error.message}</p>`;
        lastRefreshElement.textContent = "Error fetching last refresh time";
        console.error("Error:", error);
      });
  }

  // Render institutions as aggregates with dropdowns for accounts
  function renderInstitutions(institutions) {
    institutionsContainer.innerHTML = ""; // Clear existing content

    Object.keys(institutions).forEach((institutionName) => {
      const institution = institutions[institutionName];

      // Create the institution container
      const institutionDiv = document.createElement("div");
      institutionDiv.className = "institution";

      // Institution header
      const institutionHeader = document.createElement("div");
      institutionHeader.className = "institution-row";

      // Format the refresh time
      const formattedRefreshTime =
        institution.last_successful_update && institution.last_successful_update !== "Never refreshed"
          ? new Date(institution.last_successful_update).toLocaleString()
          : "Never refreshed";

      institutionHeader.innerHTML = `
        <h3>${institutionName} (${institution.accounts.length} accounts)</h3>
        <button class="refresh-institution" data-institution-id="${institution.item_id}">Refresh</button>
        <p>Last Refreshed: ${formattedRefreshTime}}</p>
      `;
      institutionHeader.addEventListener("click", () =>
        toggleAccountsTable(institutionName)
      );

      // Accounts table (initially hidden)
      const accountsTable = document.createElement("table");
      accountsTable.className = "hidden";
      accountsTable.id = `accounts-${institutionName}`;
      accountsTable.innerHTML = `
        <thead>
          <tr>
            <th>Account Name</th>
            <th>Type</th>
            <th>Subtype</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          ${institution.accounts
            .map((account) => {
              const balanceClass =
                account.balances.current < 0 ? "negative" : "positive";
              return `
              <tr>
                <td>${account.account_name}</td>
                <td>${account.type}</td>
                <td>${account.subtype}</td>
                <td class="${balanceClass}">${account.balances.current.toLocaleString(
                "en-US",
                { style: "currency", currency: "USD" }
              )}</td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      `;

      institutionDiv.appendChild(institutionHeader);
      institutionDiv.appendChild(accountsTable);
      institutionsContainer.appendChild(institutionDiv);

      // Attach event listener for the refresh button
      const refreshButton = institutionHeader.querySelector(
        ".refresh-institution"
      );
      refreshButton.addEventListener("click", (event) => {
        event.stopPropagation(); // Prevent toggling the table
        refreshInstitution(institution.item_id, institutionName);
      });
    });
  }

  // Toggle the accounts table for an institution
  function toggleAccountsTable(institutionName) {
    const table = document.getElementById(`accounts-${institutionName}`);
    if (table) {
      table.classList.toggle("hidden");
    }
  }

  // Refresh an institution's data
  function refreshInstitution(institutionId, institutionName) {
    const refreshButton = document.querySelector(
      `button[data-institution-id="${institutionId}"]`
    );
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";

    fetchData("/refresh_account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: institutionId, // Only send the item ID
      }),
    })
      .then((response) => {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
        if (response.status === "success") {
          alert(`Institution "${institutionName}" refreshed successfully!`);

          // Update the institutions and refresh time
          fetchAndRenderInstitutions();
        } else {
          alert(
            `Error refreshing "${institutionName}": ${response.error || "Unknown error"}`
          );
        }
      })
      .catch((error) => {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
        alert(`Error refreshing "${institutionName}": ${error.message}`);
      });
  }

  // Filter institutions based on search input
  function filterInstitutions() {
    const query = searchBar.value.toLowerCase();
    const institutionRows = document.querySelectorAll(".institution");

    institutionRows.forEach((row) => {
      const institutionName = row
        .querySelector("h3")
        .textContent.toLowerCase();
      row.style.display = institutionName.includes(query) ? "" : "none";
    });
  }

  // Initialize
  if (linkButton) initializePlaidLink();
  if (searchBar) searchBar.addEventListener("input", filterInstitutions);
  if (institutionsContainer) fetchAndRenderInstitutions();
});