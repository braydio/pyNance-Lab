//----------------------------------------------------
// Global Variables
//----------------------------------------------------
let allTransactions = []; // will hold all transaction data
let categoryChart;       // reference to Chart.js instance for category chart
let isCategoryPie = true;  // Category Chart: Default pie mode

let netAssetsChart;
let isNetAssetsStacked = true; // Net Assets Chart: Default stacked vs. net-only

let cashFlowChart;
let isStackedView = true; // Cash Flow Chart: default to a stacked chart
let dailyCashFlowChart; // reference to the daily (expanded) cash flow chart

//----------------------------------------------------
// A small helper function for fetching data from the server.
//----------------------------------------------------
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error);
    throw error;
  }
}

//----------------------------------------------------
// Transactions Table Setup
//----------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await initTransactionsTable();
  await renderCategoryChart();
  await renderCashFlowChart();
  setupCategoryFilterMenu(); // Initialize the filter menu

  // Category Chart toggle button
  const toggleCategoryChartBtn = document.getElementById("toggleCategoryChart");
  if (toggleCategoryChartBtn) {
    toggleCategoryChartBtn.addEventListener("click", toggleCategoryChart);
  }

  // Monthly Cash Flow Chart: expand button (replaces toggle)
  const expandCashFlowChartBtn = document.getElementById("expandCashFlowChart");
  if (expandCashFlowChartBtn) {
    expandCashFlowChartBtn.addEventListener("click", expandDailyCashFlowChart);
  }

  // Net Assets Chart toggle button
  const toggleNetAssetsBtn = document.getElementById("toggleNetAssetsChart");
  if (toggleNetAssetsBtn) {
    toggleNetAssetsBtn.addEventListener("click", toggleNetAssetsChart);
  }

  // Close button for expanded daily chart
  const closeExpandedBtn = document.getElementById("closeExpandedCashFlow");
  if (closeExpandedBtn) {
    closeExpandedBtn.addEventListener("click", () => {
      document.getElementById("expandedCashFlowContainer").style.display = "none";
    });
  }
});

//----------------------------------------------------
// Fetch and Render Transactions Table
//----------------------------------------------------
async function initTransactionsTable(page = 1, pageSize = 50) {
  const transactionsTable = document.querySelector("#transactions-table");
  if (!transactionsTable) return;

  try {
    const { status, data } = await fetchData(`/get_transactions?page=${page}&page_size=${pageSize}`);
    if (status === "success") {
      allTransactions = data.transactions;
      renderTransactionTable(allTransactions);
      updateFilterDisplay();

      // Hide reset button initially
      const resetButton = document.getElementById("resetFilter");
      if (resetButton) {
        resetButton.style.display = "none";
      }
    }
  } catch (error) {
    console.error("Error initializing transactions table:", error);
  }
}

function renderTransactionTable(transactions) {
  const transactionsTable = document.querySelector("#transactions-table tbody");
  if (!transactionsTable) return;

  transactionsTable.innerHTML = transactions
    .map(
      (tx) => `
        <tr>
          <td>${tx.date || "N/A"}</td>
          <td>${tx.amount || "N/A"}</td>
          <td>${tx.name || "N/A"}</td>
          <td>${tx.category || "Uncategorized"}</td>
          <td>${tx.merchant_name || "Unknown"}</td>
          <td>${tx.account_name || "Unknown Account"}</td>
          <td>${tx.institution_name || "Unknown Institution"}</td>
        </tr>`
    )
    .join("");
}

//----------------------------------------------------
// A stub function to update the filter display if needed.
// Modify this function to suit your UI needs.
//----------------------------------------------------
function updateFilterDisplay() {
  // For example, update a label to show the current filter.
  const filterLabel = document.getElementById("currentFilterLabel");
  if (filterLabel) {
    filterLabel.textContent = "Showing: All Categories";
  }
}

//----------------------------------------------------
// Filtering Functionality
//----------------------------------------------------
function filterTransactionsByCategory(category) {
  if (category === "All") {
    renderTransactionTable(allTransactions);
    // Optionally update a display label
    const filterLabel = document.getElementById("currentFilterLabel");
    if (filterLabel) {
      filterLabel.textContent = "Showing: All Categories";
    }
  } else {
    // Filter transactions. (Assuming tx.category is a string)
    const filtered = allTransactions.filter((tx) => tx.category === category);
    renderTransactionTable(filtered);
    const filterLabel = document.getElementById("currentFilterLabel");
    if (filterLabel) {
      filterLabel.textContent = `Showing: ${category}`;
    }
  }
}

// New filtering function: by date (for daily chart clicks)
function filterTransactionsByDate(date) {
  // Assumes that tx.date is in the same string format as the chart’s label.
  const filtered = allTransactions.filter((tx) => tx.date === date);
  renderTransactionTable(filtered);
  // Optionally scroll the transactions table into view.
  document.querySelector(".transactions").scrollIntoView({ behavior: "smooth" });
  // Show reset filter button.
  const resetButton = document.getElementById("resetFilter");
  if (resetButton) {
    resetButton.style.display = "block";
    resetButton.onclick = () => {
      renderTransactionTable(allTransactions);
      resetButton.style.display = "none";
    };
  }
}

// Create and setup the filter menu
function setupCategoryFilterMenu() {
  const filterSelect = document.getElementById("categoryFilterSelect");
  if (!filterSelect) return;

  // Set the default option (no filtering)
  filterSelect.innerHTML = `<option value="All">All Categories</option>`;

  // Populate options based on the category breakdown data.
  fetchData("/api/category_breakdown")
    .then(({ status, data }) => {
      if (status !== "success") return;
      data.forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.category;
        option.textContent = entry.category;
        filterSelect.appendChild(option);
      });
    })
    .catch((error) => {
      console.error("Error fetching category breakdown for menu:", error);
    });

  // Add an event listener to filter transactions when the selection changes.
  filterSelect.addEventListener("change", (e) => {
    filterTransactionsByCategory(e.target.value);
  });
}

//----------------------------------------------------
// Category Breakdown Chart (Pie ↔ Bar)
//----------------------------------------------------
async function renderCategoryChart() {
  const categoryCtx = document.getElementById("categoryBreakdownChart")?.getContext("2d");
  if (!categoryCtx) return;

  try {
    const { status, data } = await fetchData("/api/category_breakdown");
    if (status !== "success") return;

    // Prepare data
    const values = data.map((entry) => Math.round(entry.amount));
    const labels = data.map((entry) => entry.category);

    // Destroy old chart if exists
    if (categoryChart) categoryChart.destroy();

    categoryChart = new Chart(categoryCtx, {
      type: isCategoryPie ? "pie" : "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Spending by Category",
            data: values,
            backgroundColor: [
              "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF", "#FF9F40",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.label}: $${context.raw.toLocaleString()}`,
            },
          },
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const clickedCategory = categoryChart.data.labels[elements[0].index];
            // Update both the table and the dropdown menu.
            document.getElementById("categoryFilterSelect").value = clickedCategory;
            filterTransactionsByCategory(clickedCategory);
          }
        },
      },
    });
  } catch (error) {
    console.error("Error rendering category chart:", error);
  }
}

function toggleCategoryChart() {
  isCategoryPie = !isCategoryPie;
  renderCategoryChart();
}

// ----------------------------------------------------
// Monthly Cash Flow Chart (original)
// ----------------------------------------------------
async function renderCashFlowChart() {
  const cashFlowCtx = document.getElementById("cashFlowChart")?.getContext("2d");
  if (!cashFlowCtx) return;

  try {
    const { status, data } = await fetchData("/api/cash_flow");
    if (status !== "success") return;

    const labels = data.map((entry) => entry.month);
    const incomeData = data.map((entry) => Math.round(entry.income));
    const expenseData = data.map((entry) => -Math.round(entry.expenses));
    const netData = incomeData.map((val, idx) => val + expenseData[idx]);

    if (cashFlowChart) cashFlowChart.destroy();

    const datasets = isStackedView
      ? [
          {
            label: "Income",
            data: incomeData,
            backgroundColor: "#4BC0C0",
          },
          {
            label: "Expenses",
            data: expenseData,
            backgroundColor: "#FF6384",
          },
        ]
      : [
          {
            label: "Net Income",
            data: netData,
            backgroundColor: netData.map((value) =>
              value >= 0 ? "#4BC0C0" : "#FF6384"
            ),
          },
        ];

    cashFlowChart = new Chart(cashFlowCtx, {
      type: "bar",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) =>
                isStackedView
                  ? `${context.dataset.label}: $${context.raw.toLocaleString()}`
                  : `Net Income: $${context.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            stacked: isStackedView,
            ticks: { autoSkip: false },
          },
          y: {
            stacked: isStackedView,
            beginAtZero: true,
            ticks: { callback: (val) => `$${val.toLocaleString()}` },
          },
        },
      },
    });
  } catch (error) {
    console.error("Error rendering cash flow chart:", error);
  }
}

// ----------------------------------------------------
// Expanded Daily Cash Flow Chart (new)
// ----------------------------------------------------
async function renderDailyCashFlowChart() {
  const dailyCtx = document
    .getElementById("dailyCashFlowChart")
    .getContext("2d");
  // Fetch daily data. (Assumes your API will return daily results when ?granularity=daily is set.)
  try {
    const { status, data } = await fetchData("/api/cash_flow?granularity=daily");
    if (status !== "success") return;

    // Assume each data entry has a date, income, and expenses field.
    const labels = data.map((entry) => entry.date);
    const incomeData = data.map((entry) => Math.round(entry.income));
    const expenseData = data.map((entry) => -Math.round(entry.expenses)); // negative so bars extend left
    const netData = incomeData.map((val, idx) => val + expenseData[idx]);

    if (dailyCashFlowChart) dailyCashFlowChart.destroy();

    dailyCashFlowChart = new Chart(dailyCtx, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Income",
            data: incomeData,
            backgroundColor: "#4BC0C0",
          },
          {
            type: "bar",
            label: "Expenses",
            data: expenseData,
            backgroundColor: "#FF6384",
          },
          {
            type: "line",
            label: "Net Income",
            data: netData,
            borderColor: "#000",
            backgroundColor: "rgba(0,0,0,0.2)",
            fill: false,
            tension: 0.1,
          },
        ],
      },
      options: {
        // Render as a horizontal bar chart.
        indexAxis: "y",
        responsive: true,
        scales: {
          x: {
            beginAtZero: true,
            // Optionally, you can add grid lines with zero in the center.
          },
          y: {
            ticks: { autoSkip: false },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || "";
                if (label) {
                  label += ": ";
                }
                label += "$" + Math.abs(context.raw).toLocaleString();
                return label;
              },
            },
          },
        },
        // When a day (bar or line point) is clicked, filter transactions.
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const selectedDate = labels[idx];
            filterTransactionsByDate(selectedDate);
          }
        },
      },
    });
  } catch (error) {
    console.error("Error rendering daily cash flow chart:", error);
  }
}

function expandDailyCashFlowChart() {
  // Show the expanded container
  document.getElementById("expandedCashFlowContainer").style.display = "block";
  // Optionally, you might hide the monthly chart here if desired.
  renderDailyCashFlowChart();
}

//----------------------------------------------------
// Net Assets vs. Liabilities Chart
//----------------------------------------------------
async function renderNetAssetsChart() {
  const netAssetsCtx = document.getElementById("netAssetsChart")?.getContext("2d");
  if (!netAssetsCtx) return;

  try {
    const { status, data } = await fetchData("/api/net_assets");
    if (status !== "success") return;

    // Prepare data
    const labels = data.map((entry) => entry.period);
    const assetsData = data.map((entry) => Math.round(entry.assets));
    const liabilitiesData = data.map((entry) => -Math.round(entry.liabilities));
    const netData = assetsData.map((val, idx) => val + liabilitiesData[idx]);

    // Destroy old chart if exists
    if (netAssetsChart) netAssetsChart.destroy();

    const datasets = isNetAssetsStacked
      ? [
          {
            label: "Assets",
            data: assetsData,
            backgroundColor: "#4BC0C0",
          },
          {
            label: "Liabilities",
            data: liabilitiesData,
            backgroundColor: "#FF6384",
          },
        ]
      : [
          {
            label: "Net Assets",
            data: netData,
            backgroundColor: netData.map((value) => (value >= 0 ? "#4BC0C0" : "#FF6384")),
          },
        ];

    netAssetsChart = new Chart(netAssetsCtx, {
      type: "bar",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                return isNetAssetsStacked
                  ? `${context.dataset.label}: $${context.raw.toLocaleString()}`
                  : `Net Assets: $${context.raw.toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: isNetAssetsStacked,
            ticks: { autoSkip: false },
          },
          y: {
            stacked: isNetAssetsStacked,
            beginAtZero: true,
            ticks: { callback: (val) => `$${val.toLocaleString()}` },
          },
        },
      },
    });
  } catch (error) {
    console.error("Error rendering Net Assets chart:", error);
  }
}

function toggleNetAssetsChart() {
  isNetAssetsStacked = !isNetAssetsStacked;
  renderNetAssetsChart();
}
