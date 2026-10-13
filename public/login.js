const $ = (id) => document.getElementById(id);

function showError(message) {
  const el = $('auth-error');
  el.textContent = message;
  el.hidden = false;
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('login-submit');
  $('auth-error').hidden = true;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Sign in failed. Please try again.');
    window.location.assign('/');
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.textContent = originalLabel;
  }
});
