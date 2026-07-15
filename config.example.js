/**
 * Copia para config.local.js e preenche a apiKey (não commits).
 * Depois no index.html (antes do módulo):
 *   <script src="./config.local.js"></script>
 */
window.MAPHAJ_PLACES = {
  baseUrl: 'https://app.appmoveme.com',
  apiKey: '', // x-api-key da instância general (Failover)
  country: 'ao',
  language: 'pt'
};
