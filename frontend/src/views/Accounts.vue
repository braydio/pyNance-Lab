<template>
  <div class="accounts-page">
    <!-- Header -->
    <header class="accounts-header">
      <h1>Accounts Management</h1>
    </header>
    <!-- Charts Section -->
    <section class="charts-section">
      <LinkAccount />
      <NetYearComparisonChart />
      <AssetsBarTrended />
    </section>
    <!-- Accounts Overview -->
    <div class="accounts-overview">
      <div class="accounts-section">
        <AccountsTable />
        <div class="refresh-buttons">
          <RefreshTellerControls />
          <RefreshPlaidControls />
        </div>
      </div>
    </div>
    <!-- Drag Section -->
    <div class="accounts-drag">
      <AccountsReorderChart />
    </div>
    <!-- Footer -->
    <footer class="accounts-footer">
      &copy; good dashroad.
    </footer>
  </div>
</template>

<script>
import LinkAccount from '@/components/LinkAccount.vue';
import AccountsTable from '@/components/AccountsTable.vue';
import AccountsReorderChart from '@/components/AccountsReorderChart.vue';
import NetYearComparisonChart from '@/components/NetYearComparisonChart.vue';
import AssetsBarTrended from '@/components/AssetsBarTrended.vue';
import RefreshTellerControls from '@/components/RefreshTellerControls.vue';
import RefreshPlaidControls from '@/components/RefreshPlaidControls.vue';

export default {
  name: "Accounts",
  components: {
    LinkAccount,
    AccountsTable,
    AccountsReorderChart,
    NetYearComparisonChart,
    AssetsBarTrended,
    RefreshTellerControls,
    RefreshPlaidControls,
  }
};
</script>

<style scoped>
.accounts-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--page-bg, #1d2021);
  color: var(--gruvbox-fg);
}
.accounts-header {
  background-color: var(--gruvbox-bg);
  padding: 1rem;
  text-align: center;
  border-bottom: 1px solid var(--gruvbox-border);
}
.accounts-header h1 {
  margin: 0;
  color: var(--gruvbox-yl);
  font-size: 2rem;
}
.accounts-overview {
  margin-bottom: 1rem;
}
.accounts-section {
  background-color: var(--gruvbox-bg);
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}
.refresh-buttons {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 1rem;
}
.accounts-drag {
  margin-bottom: 1rem;
}
.accounts-footer {
  background-color: var(--gruvbox-bg);
  padding: 1rem;
  text-align: center;
  border-top: 1px solid var(--gruvbox-border);
  font-size: 0.9rem;
  color: var(--gruvbox-fg);
}
</style>
