document.addEventListener('DOMContentLoaded', () => {
    setupSidebarToggle();

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    applyStoredTheme();
    setupMenus();
    fetchAdminConfig().then(() => loadData());
});

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente interno de vendas de alta precisão para representantes comerciais.

INSTRUÇÕES IMPORTANTES:
- Responda de forma clara, direta e profissional.
- Use APENAS as informações do contexto abaixo para responder.
- Use o histórico recente apenas para entender referências da pergunta atual.
- Se a resposta não estiver no contexto, diga exatamente: "Não encontrei essa informação nos documentos disponíveis. Consulte o administrador."
- NUNCA invente preços, prazos, especificações ou qualquer dado.
- Quando mencionar valores numéricos ou preços, transcreva exatamente como consta no documento.
- Responda sempre em português (pt-BR).`;

const DEFAULT_CONTEXT_TEMPLATE = `📌 Este contexto refere-se ao arquivo: {{filename}}
Para consultar este arquivo, responda qualquer pergunta que o assistente irá usar o documento como contexto.`;

let adminConfig = {
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    contextMessageTemplate: DEFAULT_CONTEXT_TEMPLATE,
    defaultFilterFrom: ''
};

async function fetchAdminConfig() {
    try {
        const res = await fetch('api/settings/config');
        if (!res.ok) return;
        const config = await res.json();
        if (config.defaultSystemPrompt) adminConfig.defaultSystemPrompt = config.defaultSystemPrompt;
        if (config.contextMessageTemplate) adminConfig.contextMessageTemplate = config.contextMessageTemplate;
        if (typeof config.defaultFilterFrom === 'string') adminConfig.defaultFilterFrom = config.defaultFilterFrom;
    } catch (e) {
        console.warn('Erro ao carregar configurações dinâmicas:', e);
    }
}

const chatFlowDetailsCache = new Map();
const SIDEBAR_STATE_KEY = 'agc-admin-sidebar-collapsed';
const THEME_STATE_KEY = 'agc-admin-theme';

/* ============================================================
   SIDEBAR TOGGLE
   ============================================================ */
function setupSidebarToggle() {
    const btn = document.getElementById('sidebar-toggle');
    if (!btn) return;

    // Restaura o estado salvo
    const saved = localStorage.getItem(SIDEBAR_STATE_KEY);
    if (saved === 'true') {
        document.body.classList.add('sidebar-collapsed');
    }

    btn.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_STATE_KEY, String(isCollapsed));

        // Recria os ícones para garantir que o Lucide os renderize corretamente
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    });
}

/* ============================================================
   GERENCIAMENTO DE TEMA
   ============================================================ */
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.remove('theme-light');
    }

    // Atualiza o avatar para combinar com o tema
    const avatarImg = document.querySelector('.user-profile img');
    if (avatarImg) {
        const bg = theme === 'light' ? '16a34a' : 'EF4444';
        avatarImg.src = `https://ui-avatars.com/api/?name=PB&background=${bg}&color=fff`;
    }

    // Sincroniza botões do seletor se a view de configurações estiver ativa
    syncThemeButtons(theme);
}

function applyStoredTheme() {
    const stored = window.localStorage.getItem(THEME_STATE_KEY) || 'dark';
    applyTheme(stored);
}

function saveAndApplyTheme(theme) {
    window.localStorage.setItem(THEME_STATE_KEY, theme);
    applyTheme(theme);
}

function syncThemeButtons(theme) {
    const options = document.querySelectorAll('.theme-option');
    options.forEach(btn => {
        const isActive = btn.dataset.theme === theme;
        btn.classList.toggle('active', isActive);
    });
}

function buildThemeSwitcherHtml() {
    const currentTheme = window.localStorage.getItem(THEME_STATE_KEY) || 'dark';
    return `
        <div class="settings-section theme-switcher-section">
            <div class="activity-header">
                <h2>Aparência</h2>
            </div>
            <p class="theme-switcher-desc">
                Escolha a identidade visual do painel administrativo. O tema claro utiliza
                a paleta branco &amp; verde, inspirada no design da Sankhya.
            </p>
            <div class="theme-options-grid">
                <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" id="theme-btn-dark" type="button">
                    <div class="theme-preview dark">
                        <div class="theme-preview-sidebar"></div>
                        <div class="theme-preview-content">
                            <div class="theme-preview-card"></div>
                            <div class="theme-preview-card accent"></div>
                            <div class="theme-preview-card"></div>
                        </div>
                    </div>
                    <div>
                        <div class="theme-option-label">Escuro</div>
                        <div class="theme-option-sub">Interface dark com vermelho e laranja</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span class="theme-option-badge dark-badge">Padrão</span>
                        <i data-lucide="check-circle" class="theme-check-icon"></i>
                    </div>
                </button>
                <button class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light" id="theme-btn-light" type="button">
                    <div class="theme-preview light">
                        <div class="theme-preview-sidebar"></div>
                        <div class="theme-preview-content">
                            <div class="theme-preview-card"></div>
                            <div class="theme-preview-card accent"></div>
                            <div class="theme-preview-card"></div>
                        </div>
                    </div>
                    <div>
                        <div class="theme-option-label">Claro — Verde</div>
                        <div class="theme-option-sub">Interface branca &amp; verde, estilo Sankhya</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span class="theme-option-badge light-badge">Novo</span>
                        <i data-lucide="check-circle" class="theme-check-icon"></i>
                    </div>
                </button>
            </div>
        </div>
    `;
}

function bindThemeSwitcherEvents() {
    const options = document.querySelectorAll('.theme-option');
    options.forEach(btn => {
        btn.addEventListener('click', () => {
            const chosen = btn.dataset.theme;
            saveAndApplyTheme(chosen);
            syncThemeButtons(chosen);

            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
    });
}

function applySidebarState(isCollapsed) {
    document.body.classList.toggle('sidebar-collapsed', Boolean(isCollapsed));

    const toggleButton = document.getElementById('sidebar-toggle');
    if (!toggleButton) return;

    toggleButton.setAttribute('aria-label', isCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
    toggleButton.setAttribute('title', isCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
}

function setupSidebarToggle() {
    const storedValue = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    applySidebarState(storedValue === 'true');

    const toggleButton = document.getElementById('sidebar-toggle');
    if (!toggleButton) return;

    toggleButton.addEventListener('click', () => {
        const isCollapsed = !document.body.classList.contains('sidebar-collapsed');
        applySidebarState(isCollapsed);
        window.localStorage.setItem(SIDEBAR_STATE_KEY, String(isCollapsed));

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    });
}

async function loadData() {
    try {
        const statsRes = await fetch('api/stats');
        const stats = await statsRes.json();

        document.getElementById('total-questions').textContent = stats.totalQuestions || 0;
        document.getElementById('active-tenants').textContent = stats.activeTenants || 0;

        let tokens = 0;

        const historyRes = await fetch('api/history');
        const history = (await historyRes.json())
            .slice()
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 50);

        const tbody = document.querySelector('#logs-table tbody');
        if (tbody) {
            tbody.innerHTML = '';

            history.forEach(log => {
                const tr = document.createElement('tr');
                const dataStr = log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '-';
                const numZap = log.from ? log.from.replace('@s.whatsapp.net', '') : '-';
                const perguntaCurta = log.question
                    ? (log.question.length > 50 ? `${log.question.substring(0, 50)}...` : log.question)
                    : '-';

                if (log.tokens) tokens += log.tokens;

                tr.innerHTML = `
                    <td>${dataStr}</td>
                    <td><span class="tenant-badge">${log.tenant_id || '-'}</span></td>
                    <td>${numZap}</td>
                    <td title="${log.question || ''}">${perguntaCurta}</td>
                    <td><span class="table-status ${getHistorySourceMeta(log).className}">${getHistorySourceMeta(log).label}</span></td>
                `;
                tbody.appendChild(tr);
            });
        }

        const custoEstimado = ((tokens / 1000) * 0.002).toFixed(4);
        const custoEl = document.querySelector('.stat-card:nth-child(4) p');
        if (custoEl) custoEl.textContent = `$${custoEstimado}`;
    } catch (err) {
        console.error('Erro ao carregar dados da Dashboard:', err);
        alert('Erro ao carregar dados. Verifique se o servidor está rodando.');
    }
}

function groupHistoryByFlow(history) {
    const grouped = new Map();

    history.forEach(entry => {
        const key = `${entry.tenant_id || '-'}::${entry.from || '-'}`;
        const current = grouped.get(key) || [];
        current.push(entry);
        grouped.set(key, current);
    });

    return [...grouped.entries()]
        .map(([key, entries]) => {
            const sortedEntries = entries.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const recentEntries = sortedEntries.slice(-12).reverse();
            const [tenantId, from] = key.split('::');
            const firstEntry = sortedEntries[0];
            const lastEntry = sortedEntries[sortedEntries.length - 1];

            return {
                id: key,
                tenant_id: tenantId,
                from,
                questionCount: sortedEntries.length,
                totalTokens: sortedEntries.reduce((sum, entry) => sum + (entry.tokens || 0), 0),
                totalEmbeddingTokens: sortedEntries.reduce((sum, entry) => sum + (entry.tokens_embedding || 0), 0),
                firstTimestamp: firstEntry?.timestamp || '',
                lastTimestamp: lastEntry?.timestamp || '',
                lastQuestion: lastEntry?.question || '',
                entries: recentEntries
            };
        })
        .sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
}

function getStatusBadge(status) {
    const normalized = status?.lastStatus || 'idle';
    const labelMap = {
        success: 'Última ingestão OK',
        warning: 'Atenção',
        error: 'Erro',
        idle: 'Sem novidades'
    };

    return `<span class="status-pill ${normalized}">${labelMap[normalized] || 'Sem status'}</span>`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleString('pt-BR');
}

function formatPhone(remoteJid) {
    return remoteJid ? remoteJid.replace('@s.whatsapp.net', '') : '-';
}

function truncateText(value, maxLength = 120) {
    if (!value) return '-';
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getHistorySourceMeta(entry) {
    if (entry?.source === 'cron') {
        return {
            label: 'Cron',
            className: 'cron',
            icon: 'bot',
            roleLabel: 'Cron'
        };
    }

    return {
        label: 'Usuário',
        className: 'user',
        icon: 'user-round',
        roleLabel: 'Usuário'
    };
}

function getServiceStatusBadge(service) {
    const label = service.ok ? `Online${service.status ? ` (${service.status})` : ''}` : 'Offline';
    return `<span class="status-pill ${service.ok ? 'success' : 'error'}">${label}</span>`;
}

function getIngestionStatusLabel(status) {
    const normalized = status?.lastStatus || 'idle';
    const labels = {
        success: 'Ingestão OK',
        warning: 'Atenção',
        error: 'Erro',
        idle: 'Sem novidades'
    };

    return `<span class="status-pill ${normalized}">${labels[normalized] || 'Sem status'}</span>`;
}

async function testImapCredentials(email, password) {
    const response = await fetch('api/representatives/test-imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
        throw new Error('IMAP_AUTH_FAILED');
    }
}

async function createRepresentative() {
    const remoteJidInput = window.prompt('WhatsApp do representante (somente numeros, com DDI):', '5527999840201');
    if (!remoteJidInput) return;

    const email = window.prompt('E-mail do representante:', '');
    if (!email) return;

    const password = window.prompt('Senha do e-mail:', '');
    if (!password) return;

    const instance = window.prompt('Instancia Evolution:', 'AgcFrutas');
    if (!instance) return;

    const normalizedRemoteJid = remoteJidInput.includes('@s.whatsapp.net')
        ? remoteJidInput
        : `${remoteJidInput.replace(/\D/g, '')}@s.whatsapp.net`;

    try {
        await testImapCredentials(email, password);

        const response = await fetch('api/representatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                remoteJid: normalizedRemoteJid,
                email,
                password,
                whatsapp_instance: instance
            })
        });

        if (!response.ok) {
            throw new Error('CREATE_REPRESENTATIVE_FAILED');
        }

        await loadRepresentativesView();
        alert('Representante incluído com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Não foi possível validar e salvar o novo representante.');
    }
}

async function editRepresentative(remoteJid) {
    const encoded = encodeURIComponent(remoteJid);
    const response = await fetch('api/representatives');
    const representatives = await response.json();
    const rep = representatives.find(item => item.remoteJid === remoteJid);

    if (!rep) {
        alert('Representante não encontrado.');
        return;
    }

    const email = window.prompt('Novo e-mail do representante:', rep.email);
    if (!email) return;

    const password = window.prompt('Nova senha do e-mail:', rep.password || '');
    if (!password) return;

    try {
        await testImapCredentials(email, password);
        const updateRes = await fetch(`api/representatives/${encoded}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                whatsapp_instance: rep.whatsapp_instance
            })
        });

        if (!updateRes.ok) {
            throw new Error('UPDATE_FAILED');
        }

        await loadRepresentativesView();
        alert('Representante atualizado com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Não foi possível validar ou atualizar as credenciais do representante.');
    }
}

async function removeRepresentative(remoteJid) {
    const confirmDelete = window.confirm('Remover este representante? Essa ação apaga o cadastro salvo.');
    if (!confirmDelete) return;

    const encoded = encodeURIComponent(remoteJid);
    const response = await fetch(`api/representatives/${encoded}`, {
        method: 'DELETE'
    });

    if (!response.ok) {
        alert('Não foi possível remover o representante.');
        return;
    }

    await loadRepresentativesView();
}

async function testRepresentative(remoteJid) {
    const response = await fetch('api/representatives');
    const representatives = await response.json();
    const rep = representatives.find(item => item.remoteJid === remoteJid);

    if (!rep) {
        alert('Representante não encontrado.');
        return;
    }

    try {
        await testImapCredentials(rep.email, rep.password);
        alert('Conexão IMAP validada com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Falha ao validar o IMAP com as credenciais salvas.');
    }
}

async function editStaticTenant(tenantId) {
    const response = await fetch('api/tenants');
    const tenants = await response.json();
    const tenant = tenants.find(item => item.tenant_id === tenantId);

    if (!tenant) {
        alert('Tenant estÃ¡tico nÃ£o encontrado.');
        return;
    }

    const name = window.prompt('Nome do tenant:', tenant.name || '');
    if (!name) return;

    const instance = window.prompt('Instancia Evolution:', tenant.whatsapp_instance || '');
    if (!instance) return;

    const email = window.prompt('E-mail IMAP do tenant:', tenant.imap?.auth?.user || '');
    if (!email) return;

    const password = window.prompt('Senha IMAP do tenant:', tenant.imap?.auth?.pass || '');
    if (!password) return;

    const host = window.prompt('Host IMAP:', tenant.imap?.host || 'imap.kinghost.net');
    if (!host) return;

    const portInput = window.prompt('Porta IMAP:', String(tenant.imap?.port ?? 993));
    if (!portInput) return;

    const secureInput = window.prompt('IMAP seguro? (true/false):', String(tenant.imap?.secure ?? true));
    if (!secureInput) return;

    try {
        await testImapCredentials(email, password);

        const updateRes = await fetch(`api/tenants/${encodeURIComponent(tenantId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                whatsapp_instance: instance,
                imap: {
                    host,
                    port: Number(portInput),
                    secure: String(secureInput).toLowerCase() !== 'false',
                    auth: { user: email, pass: password }
                }
            })
        });

        if (!updateRes.ok) {
            throw new Error('UPDATE_STATIC_TENANT_FAILED');
        }

        await loadRepresentativesView();
        alert('Tenant estÃ¡tico atualizado com sucesso.');
    } catch (err) {
        console.error(err);
        alert('NÃ£o foi possÃ­vel validar ou atualizar o tenant estÃ¡tico.');
    }
}

async function testStaticTenant(tenantId) {
    const response = await fetch('api/tenants');
    const tenants = await response.json();
    const tenant = tenants.find(item => item.tenant_id === tenantId);

    if (!tenant) {
        alert('Tenant estÃ¡tico nÃ£o encontrado.');
        return;
    }

    try {
        await testImapCredentials(tenant.imap?.auth?.user, tenant.imap?.auth?.pass);
        alert('ConexÃ£o IMAP do tenant estÃ¡tico validada com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Falha ao validar o IMAP do tenant estÃ¡tico.');
    }
}

function normalizeRemoteJid(value) {
    if (!value) return '';
    return value.includes('@s.whatsapp.net')
        ? value
        : `${String(value).replace(/\D/g, '')}@s.whatsapp.net`;
}

function readRepresentativeFormSnapshot(form) {
    const snapshot = {};
    Array.from(form.elements).forEach(element => {
        if (!element.name) return;
        snapshot[element.name] = element.type === 'checkbox' ? element.checked : element.value;
    });
    return JSON.stringify(snapshot);
}

function updateRepresentativeFormState(form) {
    const saveBtn = form.querySelector('[data-role="save"]');
    const status = form.querySelector('[data-role="save-status"]');
    const isDirty = readRepresentativeFormSnapshot(form) !== form.dataset.initialSnapshot;

    if (saveBtn) saveBtn.disabled = !isDirty;
    if (status) {
        status.textContent = isDirty ? 'Alterações pendentes' : 'Sem alterações pendentes';
        status.classList.toggle('dirty', isDirty);
    }
}

function markRepresentativeFormSaved(form) {
    form.dataset.initialSnapshot = readRepresentativeFormSnapshot(form);
    updateRepresentativeFormState(form);
}

async function createRepresentativeFromForm(form) {
    const remoteJid = normalizeRemoteJid(form.remoteJid.value.trim());
    const email = form.email.value.trim();
    const password = form.password.value;
    const whatsappInstance = form.whatsapp_instance.value.trim();

    if (!remoteJid || !email || !password || !whatsappInstance) {
        alert('Preencha todos os campos do novo representante.');
        return;
    }

    try {
        await testImapCredentials(email, password);
        const response = await fetch('api/representatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                remoteJid,
                email,
                password,
                whatsapp_instance: whatsappInstance
            })
        });

        if (!response.ok) {
            throw new Error('CREATE_REPRESENTATIVE_FAILED');
        }

        await loadRepresentativesView();
        alert('Representante incluído com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Não foi possível validar e salvar o novo representante.');
    }
}

async function saveRepresentativeInline(form) {
    try {
        await testImapCredentials(form.email.value.trim(), form.password.value);
        const response = await fetch(`api/representatives/${encodeURIComponent(form.dataset.remoteJid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: form.email.value.trim(),
                password: form.password.value,
                whatsapp_instance: form.whatsapp_instance.value.trim()
            })
        });

        if (!response.ok) {
            throw new Error('UPDATE_FAILED');
        }

        markRepresentativeFormSaved(form);
        alert('Representante atualizado com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Não foi possível validar ou atualizar as credenciais do representante.');
    }
}

async function saveStaticTenantInline(form) {
    try {
        await testImapCredentials(form.email.value.trim(), form.password.value);
        const response = await fetch(`api/tenants/${encodeURIComponent(form.dataset.tenantId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: form.name.value.trim(),
                whatsapp_instance: form.whatsapp_instance.value.trim(),
                imap: {
                    host: form.host.value.trim(),
                    port: Number(form.port.value),
                    secure: form.secure.checked,
                    auth: {
                        user: form.email.value.trim(),
                        pass: form.password.value
                    }
                }
            })
        });

        if (!response.ok) {
            throw new Error('UPDATE_STATIC_TENANT_FAILED');
        }

        markRepresentativeFormSaved(form);
        alert('Tenant estático atualizado com sucesso.');
    } catch (err) {
        console.error(err);
        alert('Não foi possível validar ou atualizar o tenant estático.');
    }
}

function bindRepresentativePageEvents() {
    const createForm = document.getElementById('representative-create-form');
    if (createForm) {
        createForm.addEventListener('submit', async event => {
            event.preventDefault();
            await createRepresentativeFromForm(createForm);
        });
    }

    document.querySelectorAll('.representative-edit-form, .static-tenant-edit-form').forEach(form => {
        form.dataset.initialSnapshot = readRepresentativeFormSnapshot(form);
        updateRepresentativeFormState(form);
        form.addEventListener('input', () => updateRepresentativeFormState(form));
        form.addEventListener('change', () => updateRepresentativeFormState(form));
    });

    document.querySelectorAll('.representative-edit-form').forEach(form => {
        form.addEventListener('submit', async event => {
            event.preventDefault();
            await saveRepresentativeInline(form);
        });
    });

    document.querySelectorAll('.static-tenant-edit-form').forEach(form => {
        form.addEventListener('submit', async event => {
            event.preventDefault();
            await saveStaticTenantInline(form);
        });
    });

    document.querySelectorAll('[data-action="test-form-rep"]').forEach(button => {
        button.addEventListener('click', async () => {
            const form = button.closest('form');
            await testImapCredentials(form.email.value.trim(), form.password.value);
            alert('Conexão IMAP validada com sucesso.');
        });
    });

    document.querySelectorAll('[data-action="test-form-static"]').forEach(button => {
        button.addEventListener('click', async () => {
            const form = button.closest('form');
            await testImapCredentials(form.email.value.trim(), form.password.value);
            alert('Conexão IMAP do tenant estático validada com sucesso.');
        });
    });

    document.querySelectorAll('[data-action="remove"]').forEach(button => {
        button.addEventListener('click', () => removeRepresentative(button.dataset.remoteJid));
    });
}

async function loadRepresentativesView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    try {
        const [representativesRes, tenantsRes, historyRes] = await Promise.all([
            fetch('api/representatives'),
            fetch('api/tenants'),
            fetch('api/history')
        ]);

        const representatives = await representativesRes.json();
        const staticTenants = await tenantsRes.json();
        const history = await historyRes.json();
        const interactionsByTenant = new Map();

        history.forEach(item => {
            const tenantId = item.tenant_id || '';
            interactionsByTenant.set(tenantId, (interactionsByTenant.get(tenantId) || 0) + 1);
        });

        const cardsHtml = representatives.length > 0
            ? representatives.map(rep => {
                const createdAt = rep.createdAt ? new Date(rep.createdAt).toLocaleString('pt-BR') : '-';
                const updatedAt = rep.updatedAt ? new Date(rep.updatedAt).toLocaleString('pt-BR') : '-';
                const phone = rep.remoteJid ? rep.remoteJid.replace('@s.whatsapp.net', '') : '-';
                const interactionCount = interactionsByTenant.get(rep.tenant_id) || 0;
                const status = rep.ingestionStatus;

                return `
                    <article class="rep-card">
                        <div class="rep-card-header">
                            <div>
                                <h3>${escapeHtml(rep.name || rep.email)}</h3>
                                <p>${escapeHtml(rep.email)}</p>
                            </div>
                            <div class="rep-card-header-side">
                                <span class="tenant-badge">${escapeHtml(rep.tenant_id)}</span>
                                ${getStatusBadge(status)}
                            </div>
                        </div>
                        <dl class="rep-meta">
                            <div>
                                <dt>WhatsApp</dt>
                                <dd>${escapeHtml(phone)}</dd>
                            </div>
                            <div>
                                <dt>Instância</dt>
                                <dd>${escapeHtml(rep.whatsapp_instance || '-')}</dd>
                            </div>
                            <div>
                                <dt>Filtro remetente</dt>
                                <dd>${escapeHtml(adminConfig.defaultFilterFrom || '-')}</dd>
                            </div>
                            <div>
                                <dt>Criado em</dt>
                                <dd>${escapeHtml(createdAt)}</dd>
                            </div>
                            <div>
                                <dt>Atualizado em</dt>
                                <dd>${escapeHtml(updatedAt)}</dd>
                            </div>
                            <div>
                                <dt>Interações</dt>
                                <dd>${interactionCount}</dd>
                            </div>
                            <div>
                                <dt>Último arquivo</dt>
                                <dd>${escapeHtml(status?.lastFilename || '-')}</dd>
                            </div>
                            <div class="rep-meta-wide">
                                <dt>Última ingestão</dt>
                                <dd>${escapeHtml(status?.lastMessage || 'Ainda sem histórico de ingestão.')}</dd>
                            </div>
                        </dl>
                        <div class="rep-actions">
                            <button class="btn-secondary" data-action="test" data-remote-jid="${escapeHtml(rep.remoteJid)}">
                                <i data-lucide="plug-zap"></i> Testar IMAP
                            </button>
                            <button class="btn-secondary" data-action="edit" data-remote-jid="${escapeHtml(rep.remoteJid)}">
                                <i data-lucide="pencil"></i> Editar
                            </button>
                            <button class="btn-danger" data-action="remove" data-remote-jid="${escapeHtml(rep.remoteJid)}">
                                <i data-lucide="trash-2"></i> Remover
                            </button>
                        </div>
                    </article>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="users"></i>
                    <h2>Nenhum representante cadastrado</h2>
                    <p>O primeiro cadastro acontece no WhatsApp quando o usuário envia <code>/Agc</code> e conclui o onboarding de e-mail e senha.</p>
                </div>
            `;

        const staticTenantCardsHtml = staticTenants.length > 0
            ? staticTenants.map(tenant => {
                const interactionCount = interactionsByTenant.get(tenant.tenant_id) || 0;

                return `
                    <article class="rep-card">
                        <div class="rep-card-header">
                            <div>
                                <h3>${escapeHtml(tenant.name || tenant.tenant_id)}</h3>
                                <p>${escapeHtml(tenant.imap?.auth?.user || '-')}</p>
                            </div>
                            <div class="rep-card-header-side">
                                <span class="tenant-badge">${escapeHtml(tenant.tenant_id)}</span>
                                <span class="status-pill idle">EstÃ¡tico</span>
                            </div>
                        </div>
                        <dl class="rep-meta">
                            <div>
                                <dt>InstÃ¢ncia</dt>
                                <dd>${escapeHtml(tenant.whatsapp_instance || '-')}</dd>
                            </div>
                            <div>
                                <dt>Host IMAP</dt>
                                <dd>${escapeHtml(tenant.imap?.host || '-')}</dd>
                            </div>
                            <div>
                                <dt>Porta</dt>
                                <dd>${escapeHtml(String(tenant.imap?.port ?? '-'))}</dd>
                            </div>
                            <div>
                                <dt>Seguro</dt>
                                <dd>${tenant.imap?.secure ? 'Sim' : 'NÃ£o'}</dd>
                            </div>
                            <div>
                                <dt>Filtro remetente</dt>
                                <dd>${escapeHtml(adminConfig.defaultFilterFrom || '-')}</dd>
                            </div>
                            <div>
                                <dt>InteraÃ§Ãµes</dt>
                                <dd>${interactionCount}</dd>
                            </div>
                        </dl>
                        <div class="rep-actions">
                            <button class="btn-secondary" data-action="test-static" data-tenant-id="${escapeHtml(tenant.tenant_id)}">
                                <i data-lucide="plug-zap"></i> Testar IMAP
                            </button>
                            <button class="btn-secondary" data-action="edit-static" data-tenant-id="${escapeHtml(tenant.tenant_id)}">
                                <i data-lucide="pencil"></i> Editar
                            </button>
                        </div>
                    </article>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="database"></i>
                    <h2>Nenhum tenant estÃ¡tico configurado</h2>
                    <p>Os tenants fixos carregados de <code>tenants.json</code> aparecerÃ£o aqui.</p>
                </div>
            `;

        mainContent.innerHTML = `
            <header>
                <div>
                    <h2 class="view-title">Representantes</h2>
                    <p class="view-subtitle">Gerencie representantes dinÃ¢micos e tenants estÃ¡ticos a partir do painel.</p>
                </div>
                <div class="header-actions">
                    <button class="btn-secondary" id="create-representative"><i data-lucide="user-plus"></i> Incluir representante</button>
                    <button class="btn-primary" id="refresh-representatives">Atualizar <i data-lucide="refresh-cw"></i></button>
                </div>
            </header>
            <section class="representatives-summary">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>Total Cadastrado</h3>
                        <p>${representatives.length}</p>
                        <span class="trend">${representatives.length > 0 ? 'Onboarding ativo' : 'Aguardando primeiro cadastro'}</span>
                    </div>
                    <div class="stat-icon red"><i data-lucide="users"></i></div>
                </div>
            </section>
            <section class="representatives-grid">
                ${cardsHtml}
            </section>
            <section class="settings-section" style="margin-top: 28px;">
                <div class="activity-header">
                    <h2>Tenants EstÃ¡ticos</h2>
                </div>
                <div class="representatives-grid">
                    ${staticTenantCardsHtml}
                </div>
            </section>
        `;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        const refreshBtn = document.getElementById('refresh-representatives');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadRepresentativesView);
        }

        const createBtn = document.getElementById('create-representative');
        if (createBtn) {
            createBtn.addEventListener('click', createRepresentative);
        }

        document.querySelectorAll('[data-action="edit"]').forEach(button => {
            button.addEventListener('click', () => editRepresentative(button.dataset.remoteJid));
        });

        document.querySelectorAll('[data-action="remove"]').forEach(button => {
            button.addEventListener('click', () => removeRepresentative(button.dataset.remoteJid));
        });

        document.querySelectorAll('[data-action="test"]').forEach(button => {
            button.addEventListener('click', () => testRepresentative(button.dataset.remoteJid));
        });

        document.querySelectorAll('[data-action="edit-static"]').forEach(button => {
            button.addEventListener('click', () => editStaticTenant(button.dataset.tenantId));
        });

        document.querySelectorAll('[data-action="test-static"]').forEach(button => {
            button.addEventListener('click', () => testStaticTenant(button.dataset.tenantId));
        });
    } catch (err) {
        console.error('Erro ao carregar representantes:', err);
        alert('Erro ao carregar representantes cadastrados.');
    }
}

async function loadRepresentativesView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    try {
        const [representativesRes, tenantsRes, historyRes] = await Promise.all([
            fetch('api/representatives'),
            fetch('api/tenants'),
            fetch('api/history')
        ]);

        const representatives = await representativesRes.json();
        const staticTenants = await tenantsRes.json();
        const history = await historyRes.json();
        const interactionsByTenant = new Map();

        history.forEach(item => {
            const tenantId = item.tenant_id || '';
            interactionsByTenant.set(tenantId, (interactionsByTenant.get(tenantId) || 0) + 1);
        });

        const createFormHtml = `
            <form class="rep-card representative-create-form" id="representative-create-form">
                <div class="rep-card-header">
                    <div>
                        <h3>Novo representante</h3>
                        <p>Cadastre manualmente e salve sem sair da página.</p>
                    </div>
                    <span class="status-pill idle">Novo</span>
                </div>
                <div class="rep-form-grid">
                    <label class="rep-field rep-field-wide">
                        <span>WhatsApp</span>
                        <input name="remoteJid" type="text" placeholder="5527999999999" />
                    </label>
                    <label class="rep-field">
                        <span>E-mail</span>
                        <input name="email" type="email" placeholder="representante@empresa.com.br" />
                    </label>
                    <label class="rep-field">
                        <span>Senha IMAP</span>
                        <input name="password" type="password" placeholder="Senha do e-mail" />
                    </label>
                    <label class="rep-field rep-field-wide">
                        <span>Instância Evolution</span>
                        <input name="whatsapp_instance" type="text" placeholder="AgcFrutas" />
                    </label>
                </div>
                <div class="rep-actions">
                    <button class="btn-primary" type="submit">
                        <i data-lucide="save"></i> Salvar novo representante
                    </button>
                </div>
            </form>
        `;

        const dynamicCardsHtml = representatives.length > 0
            ? representatives.map(rep => {
                const createdAt = rep.createdAt ? new Date(rep.createdAt).toLocaleString('pt-BR') : '-';
                const updatedAt = rep.updatedAt ? new Date(rep.updatedAt).toLocaleString('pt-BR') : '-';
                const phone = rep.remoteJid ? rep.remoteJid.replace('@s.whatsapp.net', '') : '-';
                const interactionCount = interactionsByTenant.get(rep.tenant_id) || 0;
                const status = rep.ingestionStatus;

                return `
                    <form class="rep-card representative-edit-form" data-remote-jid="${escapeHtml(rep.remoteJid)}">
                        <div class="rep-card-header">
                            <div>
                                <h3>${escapeHtml(rep.name || rep.email)}</h3>
                                <p>${escapeHtml(rep.tenant_id)}</p>
                            </div>
                            <div class="rep-card-header-side">
                                ${getStatusBadge(status)}
                                <span class="rep-save-status" data-role="save-status">Sem alterações pendentes</span>
                            </div>
                        </div>
                        <div class="rep-form-grid">
                            <label class="rep-field">
                                <span>WhatsApp</span>
                                <input name="remoteJid" type="text" value="${escapeHtml(phone)}" readonly />
                            </label>
                            <label class="rep-field">
                                <span>Instância Evolution</span>
                                <input name="whatsapp_instance" type="text" value="${escapeHtml(rep.whatsapp_instance || '')}" />
                            </label>
                            <label class="rep-field rep-field-wide">
                                <span>E-mail</span>
                                <input name="email" type="email" value="${escapeHtml(rep.email || '')}" />
                            </label>
                            <label class="rep-field rep-field-wide">
                                <span>Senha IMAP</span>
                                <input name="password" type="password" value="${escapeHtml(rep.password || '')}" />
                            </label>
                        </div>
                        <dl class="rep-meta">
                            <div>
                                <dt>Filtro remetente</dt>
                                <dd>${escapeHtml(adminConfig.defaultFilterFrom || '-')}</dd>
                            </div>
                            <div>
                                <dt>Criado em</dt>
                                <dd>${escapeHtml(createdAt)}</dd>
                            </div>
                            <div>
                                <dt>Atualizado em</dt>
                                <dd>${escapeHtml(updatedAt)}</dd>
                            </div>
                            <div>
                                <dt>Interações</dt>
                                <dd>${interactionCount}</dd>
                            </div>
                            <div>
                                <dt>Último arquivo</dt>
                                <dd>${escapeHtml(status?.lastFilename || '-')}</dd>
                            </div>
                            <div class="rep-meta-wide">
                                <dt>Última ingestão</dt>
                                <dd>${escapeHtml(status?.lastMessage || 'Ainda sem histórico de ingestão.')}</dd>
                            </div>
                        </dl>
                        <div class="rep-actions">
                            <button class="btn-primary" type="submit" data-role="save" disabled>
                                <i data-lucide="save"></i> Salvar alterações
                            </button>
                            <button class="btn-secondary" type="button" data-action="test-form-rep">
                                <i data-lucide="plug-zap"></i> Testar IMAP
                            </button>
                            <button class="btn-danger" type="button" data-action="remove" data-remote-jid="${escapeHtml(rep.remoteJid)}">
                                <i data-lucide="trash-2"></i> Remover
                            </button>
                        </div>
                    </form>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="users"></i>
                    <h2>Nenhum representante cadastrado</h2>
                    <p>Use o formulário acima para cadastrar o primeiro representante manualmente.</p>
                </div>
            `;

        const staticTenantCardsHtml = staticTenants.length > 0
            ? staticTenants.map(tenant => {
                const interactionCount = interactionsByTenant.get(tenant.tenant_id) || 0;

                return `
                    <form class="rep-card static-tenant-edit-form" data-tenant-id="${escapeHtml(tenant.tenant_id)}">
                        <div class="rep-card-header">
                            <div>
                                <h3>${escapeHtml(tenant.tenant_id)}</h3>
                                <p>Tenant estático</p>
                            </div>
                            <div class="rep-card-header-side">
                                <span class="status-pill idle">Estático</span>
                                <span class="rep-save-status" data-role="save-status">Sem alterações pendentes</span>
                            </div>
                        </div>
                        <div class="rep-form-grid">
                            <label class="rep-field rep-field-wide">
                                <span>Nome</span>
                                <input name="name" type="text" value="${escapeHtml(tenant.name || '')}" />
                            </label>
                            <label class="rep-field">
                                <span>Instância Evolution</span>
                                <input name="whatsapp_instance" type="text" value="${escapeHtml(tenant.whatsapp_instance || '')}" />
                            </label>
                            <label class="rep-field">
                                <span>Host IMAP</span>
                                <input name="host" type="text" value="${escapeHtml(tenant.imap?.host || '')}" />
                            </label>
                            <label class="rep-field">
                                <span>Porta IMAP</span>
                                <input name="port" type="number" value="${escapeHtml(String(tenant.imap?.port ?? 993))}" />
                            </label>
                            <label class="rep-field rep-checkbox-field">
                                <span>IMAP seguro</span>
                                <input name="secure" type="checkbox" ${tenant.imap?.secure ? 'checked' : ''} />
                            </label>
                            <label class="rep-field rep-field-wide">
                                <span>E-mail IMAP</span>
                                <input name="email" type="email" value="${escapeHtml(tenant.imap?.auth?.user || '')}" />
                            </label>
                            <label class="rep-field rep-field-wide">
                                <span>Senha IMAP</span>
                                <input name="password" type="password" value="${escapeHtml(tenant.imap?.auth?.pass || '')}" />
                            </label>
                        </div>
                        <dl class="rep-meta">
                            <div>
                                <dt>Filtro remetente</dt>
                                <dd>${escapeHtml(adminConfig.defaultFilterFrom || '-')}</dd>
                            </div>
                            <div>
                                <dt>Interações</dt>
                                <dd>${interactionCount}</dd>
                            </div>
                        </dl>
                        <div class="rep-actions">
                            <button class="btn-primary" type="submit" data-role="save" disabled>
                                <i data-lucide="save"></i> Salvar alterações
                            </button>
                            <button class="btn-secondary" type="button" data-action="test-form-static">
                                <i data-lucide="plug-zap"></i> Testar IMAP
                            </button>
                        </div>
                    </form>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="database"></i>
                    <h2>Nenhum tenant estático configurado</h2>
                    <p>Os tenants fixos carregados de <code>tenants.json</code> aparecerão aqui.</p>
                </div>
            `;

        mainContent.innerHTML = `
            <header>
                <div>
                    <h2 class="view-title">Representantes</h2>
                    <p class="view-subtitle">Edite e salve cadastros diretamente nos formulários abaixo.</p>
                </div>
                <div class="header-actions">
                    <button class="btn-primary" id="refresh-representatives">Atualizar <i data-lucide="refresh-cw"></i></button>
                </div>
            </header>
            <section class="representatives-summary">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>Total Cadastrado</h3>
                        <p>${representatives.length}</p>
                        <span class="trend">${representatives.length > 0 ? 'Onboarding ativo' : 'Aguardando primeiro cadastro'}</span>
                    </div>
                    <div class="stat-icon red"><i data-lucide="users"></i></div>
                </div>
            </section>
            <section class="representatives-grid">
                ${createFormHtml}
                ${dynamicCardsHtml}
            </section>
            <section class="settings-section" style="margin-top: 28px;">
                <div class="activity-header">
                    <h2>Tenants Estáticos</h2>
                </div>
                <div class="representatives-grid">
                    ${staticTenantCardsHtml}
                </div>
            </section>
        `;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        const refreshBtn = document.getElementById('refresh-representatives');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadRepresentativesView);
        }

        bindRepresentativePageEvents();
    } catch (err) {
        console.error('Erro ao carregar representantes:', err);
        alert('Erro ao carregar representantes cadastrados.');
    }
}

function bindChatFlowEvents() {
    const cards = document.querySelectorAll('.chat-flow-card');
    const detailsPanel = document.getElementById('chat-flow-details');
    if (!cards.length || !detailsPanel) return;

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(item => item.classList.remove('active'));
            card.classList.add('active');
            const detailsHtml = chatFlowDetailsCache.get(card.dataset.flowId) || '';
            detailsPanel.innerHTML = detailsHtml;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
    });

    cards[0].click();
}

async function loadChatFlowsView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    try {
        const response = await fetch('api/history');
        const history = await response.json();
        const flows = groupHistoryByFlow(history);
        chatFlowDetailsCache.clear();

        const totalMessages = flows.reduce((sum, flow) => sum + (flow.questionCount || 0), 0);
        const totalTokens = flows.reduce((sum, flow) => sum + (flow.totalTokens || 0), 0);

        const listHtml = flows.length > 0
            ? flows.map((flow, index) => {
                const flowId = `flow-${index}`;
                const phone = formatPhone(flow.from);
                const entriesHtml = (flow.entries || []).map(entry => `
                    <article class="chat-flow-entry">
                        <div class="chat-flow-entry-header">
                            <span class="chat-flow-role ${getHistorySourceMeta(entry).className}"><i data-lucide="${getHistorySourceMeta(entry).icon}"></i> ${getHistorySourceMeta(entry).roleLabel}</span>
                            <time>${escapeHtml(formatDate(entry.timestamp))}</time>
                        </div>
                        <p class="chat-flow-question">${escapeHtml(entry.question || '-')}</p>
                        <div class="chat-flow-entry-header answer">
                            <span class="chat-flow-role assistant"><i data-lucide="bot"></i> Assistente</span>
                            <span class="chat-flow-metrics">${getHistorySourceMeta(entry).label} • ${entry.tokens || 0} tokens resposta • ${entry.tokens_embedding || 0} embeddings</span>
                        </div>
                        <div class="chat-flow-answer">${escapeHtml(entry.answer || '-').replace(/\n/g, '<br>')}</div>
                    </article>
                `).join('');

                const detailsHtml = `
                    <section class="chat-flow-panel-card">
                        <div class="chat-flow-panel-top">
                            <div>
                                <h3>${escapeHtml(phone)}</h3>
                                <p>${escapeHtml(flow.tenant_id)}</p>
                            </div>
                            <span class="tenant-badge">${escapeHtml(flow.questionCount)} interações</span>
                        </div>
                        <dl class="chat-flow-panel-meta">
                            <div>
                                <dt>Primeira interação</dt>
                                <dd>${escapeHtml(formatDate(flow.firstTimestamp))}</dd>
                            </div>
                            <div>
                                <dt>Última interação</dt>
                                <dd>${escapeHtml(formatDate(flow.lastTimestamp))}</dd>
                            </div>
                            <div>
                                <dt>Tokens resposta</dt>
                                <dd>${escapeHtml(flow.totalTokens)}</dd>
                            </div>
                            <div>
                                <dt>Tokens embeddings</dt>
                                <dd>${escapeHtml(flow.totalEmbeddingTokens)}</dd>
                            </div>
                        </dl>
                    </section>
                    <section class="chat-flow-timeline">
                        ${entriesHtml}
                    </section>
                `;

                chatFlowDetailsCache.set(flowId, detailsHtml);

                return `
                    <button class="chat-flow-card ${index === 0 ? 'active' : ''}" data-flow-id="${flowId}">
                        <div class="chat-flow-card-top">
                            <div>
                                <h3>${escapeHtml(phone)}</h3>
                                <p>${escapeHtml(flow.tenant_id)}</p>
                            </div>
                            <span class="tenant-badge">${escapeHtml(flow.questionCount)} msgs</span>
                        </div>
                        <p class="chat-flow-last-question">${escapeHtml(truncateText(flow.lastQuestion, 90))}</p>
                        <div class="chat-flow-card-footer">
                            <span>${escapeHtml(formatDate(flow.lastTimestamp))}</span>
                            <span>${escapeHtml(flow.totalTokens)} tokens</span>
                        </div>
                    </button>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="message-square-off"></i>
                    <h2>Nenhum log de chat encontrado</h2>
                    <p>As conversas processadas pelo assistente vão aparecer aqui em formato de fluxo completo.</p>
                </div>
            `;

        mainContent.innerHTML = `
            <header>
                <div>
                    <h2 class="view-title">Logs de Chat</h2>
                    <p class="view-subtitle">Mapeamento completo do fluxo por representante, tenant e sequência de perguntas e respostas.</p>
                </div>
                <div class="header-actions">
                    <button class="btn-primary" id="refresh-chat-flows">Atualizar <i data-lucide="refresh-cw"></i></button>
                </div>
            </header>
            <section class="stats-grid logs-stats-grid">
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>Conversas Mapeadas</h3>
                        <p>${flows.length}</p>
                        <span class="trend">${flows.length > 0 ? 'Agrupadas por tenant + WhatsApp' : 'Sem dados ainda'}</span>
                    </div>
                    <div class="stat-icon red"><i data-lucide="messages-square"></i></div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>Total de Interações</h3>
                        <p>${totalMessages}</p>
                        <span class="trend">${flows.length > 0 ? 'Perguntas registradas no history.json' : 'Aguardando primeira conversa'}</span>
                    </div>
                    <div class="stat-icon orange"><i data-lucide="message-circle-more"></i></div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>Tokens Resposta</h3>
                        <p>${totalTokens}</p>
                        <span class="trend">${flows.length > 0 ? 'Soma estimada do fluxo exibido' : 'Sem consumo registrado'}</span>
                    </div>
                    <div class="stat-icon red"><i data-lucide="database-zap"></i></div>
                </div>
            </section>
            <section class="chat-flows-layout">
                <div class="chat-flows-list">
                    ${listHtml}
                </div>
                <div class="chat-flow-details" id="chat-flow-details">
                    <div class="empty-state">
                        <i data-lucide="messages-square"></i>
                        <h2>Selecione uma conversa</h2>
                        <p>O painel mostra a linha do tempo completa das perguntas e respostas registradas.</p>
                    </div>
                </div>
            </section>
        `;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        const refreshBtn = document.getElementById('refresh-chat-flows');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadChatFlowsView);
        }

        bindChatFlowEvents();
    } catch (err) {
        console.error('Erro ao carregar logs de chat:', err);
        alert('Erro ao carregar o mapeamento dos fluxos de chat.');
    }
}

async function loadSettingsView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    try {
        await fetchAdminConfig();
        const response = await fetch('api/settings');
        const settings = await response.json();
        const parameters = settings.parameters || {};
        const services = settings.services || [];
        const representativeStatuses = settings.representativeStatuses || [];

        const parameterItems = [
            ['Porta principal', parameters.port],
            ['Agendamento do cron', parameters.cronSchedule],
            ['Provider de embeddings', parameters.embeddingsProvider],
            ['Modelo local', parameters.localEmbeddingModel],
            ['Python embeddings', parameters.localEmbeddingPythonBin],
            ['Qdrant URL', parameters.qdrantUrl],
            ['Collection Qdrant', parameters.qdrantCollection],
            ['Recriar collection por dimensão', parameters.qdrantRecreateOnMismatch ? 'Sim' : 'Não'],
            ['Evolution URL', parameters.evolutionApiUrl],
            ['Evolution API Key', parameters.evolutionApiKey],
            ['Gemini API Key', parameters.geminiApiKey],
            ['OpenRouter configurado', parameters.openrouterConfigured ? 'Sim' : 'Não'],
            ['Filtro de remetente ativo', parameters.senderFilterFrom],
            ['Fallback legado (.env)', parameters.legacyCompanyEmail],
            ['Representantes cadastrados', parameters.representativesCount],
            ['Tenants estáticos', parameters.staticTenantsCount]
        ];

        const servicesHtml = services.map(service => `
            <article class="settings-card">
                <div class="settings-card-top">
                    <div>
                        <h3>${escapeHtml(service.name)}</h3>
                        <p>${escapeHtml(service.url)}</p>
                    </div>
                    ${getServiceStatusBadge(service)}
                </div>
            </article>
        `).join('');

        const parametersHtml = parameterItems.map(([label, value]) => `
            <div class="settings-row">
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
            </div>
        `).join('');

        const representativeStatusHtml = representativeStatuses.length > 0
            ? representativeStatuses.map(rep => {
                const status = rep.ingestionStatus;
                return `
                    <article class="settings-card">
                        <div class="settings-card-top">
                            <div>
                                <h3>${escapeHtml(rep.email)}</h3>
                                <p>${escapeHtml(formatPhone(rep.remoteJid))} • ${escapeHtml(rep.whatsapp_instance || '-')}</p>
                            </div>
                            ${getIngestionStatusLabel(status)}
                        </div>
                        <dl class="settings-inline-list">
                            <div>
                                <dt>Última checagem</dt>
                                <dd>${escapeHtml(formatDate(status?.lastCheckAt))}</dd>
                            </div>
                            <div>
                                <dt>Último arquivo</dt>
                                <dd>${escapeHtml(status?.lastFilename || '-')}</dd>
                            </div>
                            <div class="settings-inline-wide">
                                <dt>Status IMAP / ingestão</dt>
                                <dd>${escapeHtml(status?.lastMessage || 'Ainda sem histórico de ingestão.')}</dd>
                            </div>
                        </dl>
                    </article>
                `;
            }).join('')
            : `
                <div class="empty-state">
                    <i data-lucide="mail-warning"></i>
                    <h2>Nenhum representante monitorado</h2>
                    <p>Os status IMAP por representante vão aparecer aqui depois do primeiro cadastro.</p>
                </div>
            `;

        mainContent.innerHTML = `
            <header>
                <div>
                    <h2 class="view-title">Configurações</h2>
                    <p class="view-subtitle">Parâmetros operacionais e status atual dos serviços principais.</p>
                </div>
                <div class="header-actions">
                    <button class="btn-primary" id="refresh-settings">Atualizar <i data-lucide="refresh-cw"></i></button>
                </div>
            </header>
            <section class="settings-layout">
                ${buildThemeSwitcherHtml()}
                <div class="settings-section">
                    <div class="activity-header">
                        <h2>Status dos Serviços</h2>
                    </div>
                    <div class="settings-grid">
                        ${servicesHtml}
                    </div>
                </div>

                <div class="settings-section">
                    <div class="activity-header">
                        <h2>Leitura Avançada de PDF</h2>
                    </div>
                    <form id="pdf-settings-form" class="settings-card" style="display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem;">
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Estratégia de Parsing</label>
                            <select id="pdfParserStrategy" style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);">
                                <option value="local" ${parameters.pdfParserStrategy !== 'llamaparse' ? 'selected' : ''}>Local (pdf-parse) - Rápido</option>
                                <option value="llamaparse" ${parameters.pdfParserStrategy === 'llamaparse' ? 'selected' : ''}>LlamaParse API - Ideal para tabelas</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">LlamaParse API Key (Requerido se LlamaParse for escolhido)</label>
                            <input type="password" id="llamacloudApiKey" style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" placeholder="Atualize sua API Key colando aqui..." />
                        </div>
                        <button type="submit" class="btn-primary" style="align-self: flex-start; margin-top: 0.5rem;">Salvar e Configurar Módulo PDF <i data-lucide="save"></i></button>
                    </form>
                </div>

                <div class="settings-section">
                    <div class="activity-header">
                        <h2>Configurações de Prompt e Mensagens</h2>
                    </div>
                    <form id="prompts-settings-form" class="settings-card" style="display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem;">
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Filtro padrÃ£o de remetente</label>
                            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 0.5rem;">Somente e-mails desse remetente serÃ£o ingeridos para todos os tenants carregados em runtime, incluindo os estÃ¡ticos e os cadastrados no painel. Exemplo: <code>suporte@empresa.com.br</code>.</p>
                            <input id="configDefaultFilterFrom" type="email" style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" value="${escapeHtml(adminConfig.defaultFilterFrom || '')}" placeholder="suporte@empresa.com.br" />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Prompt Padrão do Assistente</label>
                            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 0.5rem;">O comportamento global configurado para todos os representantes e arquivos (caso não haja um prompt específico).</p>
                            <textarea id="configDefaultSystemPrompt" style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-family: monospace; resize: vertical;" rows="10" spellcheck="false">${escapeHtml(adminConfig.defaultSystemPrompt)}</textarea>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Acompanhamento no envio de mensagem</label>
                            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 0.5rem;">A mensagem fixada junto à resposta que aponta o arquivo enviado pelo admin. Use <code>{{filename}}</code> para inserir o nome do arquivo.</p>
                            <textarea id="configContextMessageTemplate" style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-family: monospace; resize: vertical;" rows="4" spellcheck="false">${escapeHtml(adminConfig.contextMessageTemplate)}</textarea>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 0.5rem;">
                            <button type="submit" class="btn-primary">Salvar Configurações <i data-lucide="save"></i></button>
                            <div id="prompts-save-feedback" style="display: none; align-items: center; gap: 4px; color: var(--text-success); font-size: 13px; font-weight: 600;">
                                <i data-lucide="check-circle" style="width:16px;height:16px;"></i> Salvo!
                            </div>
                        </div>
                    </form>
                </div>

                <div class="settings-section">
                    <div class="activity-header">
                        <h2>Parâmetros</h2>
                    </div>
                    <dl class="settings-list">
                        ${parametersHtml}
                    </dl>
                </div>
                <div class="settings-section">
                    <div class="activity-header">
                        <h2>Status por Representante</h2>
                    </div>
                    <div class="settings-grid">
                        ${representativeStatusHtml}
                    </div>
                </div>
            </section>
        `;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        bindThemeSwitcherEvents();

        const refreshBtn = document.getElementById('refresh-settings');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadSettingsView);
        }

        const promptsForm = document.getElementById('prompts-settings-form');
        if (promptsForm) {
            promptsForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const defaultFilterFrom = document.getElementById('configDefaultFilterFrom').value.trim();
                const defaultSystemPrompt = document.getElementById('configDefaultSystemPrompt').value;
                const contextMessageTemplate = document.getElementById('configContextMessageTemplate').value;

                try {
                    const response = await fetch('api/settings/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ defaultFilterFrom, defaultSystemPrompt, contextMessageTemplate })
                    });

                    if (!response.ok) {
                        const errorInfo = await response.json().catch(() => ({}));
                        throw new Error(errorInfo.error || 'SETTINGS_CONFIG_SAVE_FAILED');
                    }
                    
                    adminConfig.defaultFilterFrom = defaultFilterFrom;
                    adminConfig.defaultSystemPrompt = defaultSystemPrompt;
                    adminConfig.contextMessageTemplate = contextMessageTemplate;
                    
                    const feedback = document.getElementById('prompts-save-feedback');
                    if (feedback) {
                        feedback.style.display = 'flex';
                        setTimeout(() => feedback.style.display = 'none', 3000);
                    }

                    await fetchAdminConfig();
                    await loadSettingsView();
                } catch (err) {
                    alert('Erro ao salvar prompts: ' + err.message);
                }
            });
        }

        const pdfForm = document.getElementById('pdf-settings-form');
        if (pdfForm) {
            pdfForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const strategy = document.getElementById('pdfParserStrategy').value;
                const apiKey = document.getElementById('llamacloudApiKey').value;

                try {
                    const res = await fetch('api/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pdfParserStrategy: strategy, llamacloudApiKey: apiKey || undefined })
                    });
                    if (res.ok) {
                        alert('Configurações foram salvas no arquivo .env!\n\nATENÇÃO: Você PRECISARÁ reiniciar o sistema operando via Stop_all.ps1 e Start_all.ps1 para que os módulos centrais iniciem lendo as novas variáveis.');
                        loadSettingsView();
                    } else {
                        const errInfo = await res.json();
                        alert('Falha ao gravar configurações: ' + (errInfo.error || 'Erro Desconhecido'));
                    }
                } catch (err) {
                    console.error(err);
                    alert('Erro na comunicação com o backend.');
                }
            });
        }
    } catch (err) {
        console.error('Erro ao carregar configurações:', err);
        alert('Erro ao carregar parâmetros e status dos serviços.');
    }
}

function loadAnalyticsView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    mainContent.innerHTML = `
        <header>
            <div>
                <h2 class="view-title">Analytics</h2>
                <p class="view-subtitle">Fluxograma operacional do AGC, do recebimento de documentos até a resposta no WhatsApp.</p>
            </div>
        </header>
        <section class="analytics-layout">
            <div class="analytics-section">
                <div class="analytics-hero">
                    <div>
                        <span class="analytics-eyebrow">Arquitetura operacional</span>
                        <h2>Fluxo ponta a ponta do AGC</h2>
                        <p>Uma visão conectada entre entrada por WhatsApp, ingestão por e-mail, indexação vetorial e resposta assistida por contexto.</p>
                    </div>
                    <div class="analytics-hero-badge">
                        <span>4 serviços externos</span>
                        <strong>1 hub RAG central</strong>
                    </div>
                </div>
                <div class="activity-header">
                    <h2>Fluxograma conectado</h2>
                </div>
                <div class="process-map">
                    <div class="process-column">
                        <h3>Canal WhatsApp</h3>
                        <div class="process-node primary">
                            <span class="flow-kicker">Entrada</span>
                            <strong>Usuário envia <code>/Agc</code></strong>
                            <p>Evolution API entrega o evento ao webhook V2 e o representante é identificado.</p>
                        </div>
                        <div class="process-link vertical"></div>
                        <div class="process-node">
                            <span class="flow-kicker">Sessão</span>
                            <strong>Ativa conversa e histórico</strong>
                            <p>Sessão é validada, histórico recente é carregado e a pergunta segue para busca contextual.</p>
                        </div>
                        <div class="process-side-note">
                            <i data-lucide="files"></i>
                            <span>Histórico local em <code>history.json</code></span>
                        </div>
                        <div class="process-link vertical"></div>
                        <div class="process-node accent">
                            <span class="flow-kicker">Saída</span>
                            <strong>Gemini responde no WhatsApp</strong>
                            <p>O contexto recuperado é enviado ao modelo e a resposta volta pela Evolution.</p>
                        </div>
                    </div>

                    <div class="process-hub">
                        <div class="process-link horizontal top"></div>
                        <div class="process-node hub">
                            <span class="flow-kicker">Motor RAG</span>
                            <strong>Qdrant + Embeddings Locais</strong>
                            <p>Os chunks são indexados e recuperados por <code>tenant_id</code> com embeddings locais.</p>
                            <div class="hub-pills">
                                <span>Busca vetorial</span>
                                <span>Metadados do e-mail</span>
                                <span>Resumo estruturado</span>
                            </div>
                        </div>
                        <div class="process-link horizontal bottom"></div>
                    </div>

                    <div class="process-column">
                        <h3>Fluxo de documentos</h3>
                        <div class="process-node">
                            <span class="flow-kicker">Cron IMAP</span>
                            <strong>Busca e-mails não lidos</strong>
                            <p>Varredura periódica nas caixas dos representantes cadastrados.</p>
                        </div>
                        <div class="process-link vertical"></div>
                        <div class="process-node">
                            <span class="flow-kicker">Ingestão</span>
                            <strong>Extrai, chunka e indexa</strong>
                            <p>O anexo suportado é baixado, convertido em texto e indexado com metadados no Qdrant.</p>
                        </div>
                        <div class="process-side-note">
                            <i data-lucide="database"></i>
                            <span>UID, assunto, remetente, data e MIME seguem no payload</span>
                        </div>
                        <div class="process-link vertical"></div>
                        <div class="process-node accent">
                            <span class="flow-kicker">Retorno</span>
                            <strong>Encaminha arquivo e pós-ingestão</strong>
                            <p>Depois da indexação, o documento e a resposta automática são enviados ao WhatsApp.</p>
                        </div>
                    </div>
                </div>
                <div class="process-caption-grid">
                    <div class="process-caption-card">
                        <h4>Conexão 1</h4>
                        <p>O fluxo de chat consulta o hub RAG antes de gerar qualquer resposta ao usuário.</p>
                    </div>
                    <div class="process-caption-card">
                        <h4>Conexão 2</h4>
                        <p>O fluxo de documentos alimenta o mesmo hub RAG, tornando novos anexos consultáveis no WhatsApp.</p>
                    </div>
                </div>
            </div>
            <div class="analytics-grid">
                <article class="analytics-card">
                    <h3>APIs externas</h3>
                    <ul class="analytics-list">
                        <li>Evolution API para mensagens e documentos no WhatsApp</li>
                        <li>Gemini para geração das respostas finais</li>
                        <li>IMAP do servidor de e-mail para ingestão</li>
                        <li>Qdrant para recuperação vetorial</li>
                    </ul>
                </article>
                <article class="analytics-card">
                    <h3>Componentes locais</h3>
                    <ul class="analytics-list">
                        <li>Embeddings locais em Python com Transformers</li>
                        <li>Histórico em <code>v2_data/history.json</code></li>
                        <li>Status de ingestão em <code>v2_data/ingestion_status.json</code></li>
                        <li>Painel V2 servindo dashboard, logs, representantes e configurações</li>
                    </ul>
                </article>
                <article class="analytics-card">
                    <h3>Regras operacionais</h3>
                    <ul class="analytics-list">
                        <li>Antes de <code>/Agc</code>, o bot permanece em silêncio</li>
                        <li>O cron processa apenas e-mails não lidos</li>
                        <li>Mesmo nome de arquivo substitui a versão anterior no índice</li>
                        <li>O envio do documento ocorre somente após a vetorização concluir</li>
                    </ul>
                </article>
            </div>
        </section>
    `;

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function renderPlaceholderView(dashboardHtml, title) {
    const mainContent = document.querySelector('.content');
    const parser = new DOMParser();
    const doc = parser.parseFromString(dashboardHtml, 'text/html');
    const headerHtml = doc.querySelector('header').outerHTML;

    mainContent.innerHTML = `
        ${headerHtml}
        <div class="placeholder-module">
            <i data-lucide="monitor-off"></i>
            <h2>${title}</h2>
            <p>Este módulo está em fase de desenvolvimento ou integração.</p>
            <p>Aguarde as próximas atualizações do painel administrativo.</p>
        </div>
    `;

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

let explorerState = {
    tenants: [],
    aiPrompts: {},        // { "tenantId:filename": "prompt..." }
    selectedTenantId: null,
    selectedFilename: null,
    selectedRemoteJid: null,
    selectedInstance: null,
    selectedTenantName: null,
    mode: 'chat',         // 'chat' | 'ai'
};

async function loadExplorerView() {
    const mainContent = document.querySelector('.content');
    if (!mainContent) return;

    mainContent.innerHTML = `
        <header>
            <div>
                <h2 class="view-title">Explorer</h2>
                <p class="view-subtitle">Gerencie arquivos por representante: chat ao vivo e configuração do assistente de IA.</p>
            </div>
            <div class="header-actions">
                <button class="btn-primary" id="refresh-explorer">Atualizar <i data-lucide="refresh-cw"></i></button>
            </div>
        </header>
        <div class="explorer-layout" id="explorer-layout">
            <!-- Árvore com 2 seções raiz -->
            <div class="explorer-tree-panel" id="explorer-tree">
                <div class="explorer-panel-header">
                    <h3>Explorer</h3>
                    <p>Selecione uma seção e um arquivo</p>
                </div>
                <div class="explorer-tree-body" id="explorer-tree-body">
                    <div class="explorer-empty">
                        <i data-lucide="loader-circle"></i>
                        <p>Carregando...</p>
                    </div>
                </div>
            </div>

            <!-- Painel central: chat OU editor de prompt -->
            <div class="explorer-chat-panel" id="explorer-center-panel">
                <div class="explorer-panel-header" id="explorer-chat-header">
                    <h3>Histórico de Chat</h3>
                    <p class="explorer-panel-meta">Selecione um arquivo na árvore</p>
                </div>
                <div class="explorer-chat-body" id="explorer-chat-body">
                    <div class="explorer-empty">
                        <i data-lucide="folder-open"></i>
                        <h2>Selecione um arquivo</h2>
                        <p>Clique em um arquivo na seção <strong>Representantes &amp; Arquivos</strong> para ver o histórico de chat, ou em <strong>Assistente de IA</strong> para editar o prompt.</p>
                    </div>
                </div>
            </div>

            <!-- Painel direito: composer de mensagem OU info do arquivo AI -->
            <div class="explorer-composer-panel" id="explorer-right-panel">
                <div class="explorer-panel-header">
                    <h3 id="right-panel-title">Enviar Mensagem</h3>
                    <p class="explorer-panel-meta" id="right-panel-subtitle">Dispare uma mensagem ao representante</p>
                </div>
                <div id="right-panel-body" class="explorer-composer-body">
                    <div class="explorer-composer-row">
                        <span class="explorer-composer-label">Representante</span>
                        <div class="explorer-composer-info" id="composer-rep-info">
                            <i data-lucide="user-round"></i>
                            <span>Nenhum arquivo selecionado</span>
                        </div>
                    </div>
                    <div class="explorer-composer-row" id="composer-file-row" style="display:none">
                        <span class="explorer-composer-label">Arquivo de contexto</span>
                        <div class="explorer-composer-info" id="composer-file-info">
                            <i data-lucide="file-text"></i>
                            <strong id="composer-file-name">—</strong>
                        </div>
                    </div>
                    <div class="explorer-composer-row">
                        <span class="explorer-composer-label">Mensagem</span>
                        <textarea
                            class="explorer-composer-textarea"
                            id="composer-message"
                            placeholder="Digite a mensagem para o representante..."
                            rows="5"
                        ></textarea>
                    </div>
                    <div class="explorer-composer-row">
                        <div class="explorer-composer-preview-label">Prévia da mensagem que será enviada</div>
                        <div class="explorer-composer-preview visible" id="composer-preview">
                            ---
                        </div>
                    </div>
                </div>
                <div class="explorer-composer-footer" id="right-panel-footer">
                    <div class="explorer-send-status" id="explorer-send-status">
                        <i data-lucide="check-circle"></i>
                        Enviado com sucesso!
                    </div>
                    <button class="btn-primary" id="composer-send-btn" disabled>
                        <i data-lucide="send"></i> Enviar via WhatsApp
                    </button>
                </div>
            </div>
        </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    document.getElementById('refresh-explorer')?.addEventListener('click', loadExplorerView);
    document.getElementById('composer-message')?.addEventListener('input', onComposerInput);
    document.getElementById('composer-send-btn')?.addEventListener('click', sendAdminMessage);

    try {
        const [tenantsRes, promptsRes] = await Promise.all([
            fetch('api/explorer'),
            fetch('api/explorer/ai-prompts'),
        ]);
        const tenants = await tenantsRes.json();
        const aiPrompts = await promptsRes.json();
        explorerState.tenants = tenants;
        explorerState.aiPrompts = aiPrompts;
        renderExplorerTree(tenants, aiPrompts);
    } catch (err) {
        console.error('Erro ao carregar explorer:', err);
        const treeBody = document.getElementById('explorer-tree-body');
        if (treeBody) treeBody.innerHTML = `<div class="explorer-empty"><i data-lucide="wifi-off"></i><p>Erro ao carregar arquivos.</p></div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function buildFilesHtml(tenants, mode) {
    return tenants.map((tenant, tIdx) => {
        const prefix = `${mode}-${tIdx}`;
        const filesHtml = tenant.files.map(file => {
            const date = file.lastSeen ? new Date(file.lastSeen).toLocaleDateString('pt-BR') : '';
            const hasCustomPrompt = !!explorerState.aiPrompts[`${tenant.tenant_id}:${file.name}`];
            const aiDot = (mode === 'ai' && hasCustomPrompt)
                ? `<span style="width:7px;height:7px;border-radius:50%;background:#fbbf24;flex-shrink:0;display:inline-block;" title="Prompt personalizado"></span>`
                : '';
            return `
                <button
                    class="explorer-file-item"
                    data-mode="${mode}"
                    data-tenant-id="${escapeHtml(tenant.tenant_id)}"
                    data-filename="${escapeHtml(file.name)}"
                    data-remote-jid="${escapeHtml(tenant.remoteJid)}"
                    data-instance="${escapeHtml(tenant.whatsapp_instance)}"
                    data-tenant-name="${escapeHtml(tenant.name)}"
                    title="${escapeHtml(file.name)}"
                >
                    <i data-lucide="${mode === 'ai' ? 'cpu' : 'file-text'}"></i>
                    <span class="explorer-file-name">${escapeHtml(file.name)}</span>
                    ${aiDot}
                    <span class="explorer-file-date">${date}</span>
                    <span class="explorer-file-count">${file.count}x</span>
                </button>
            `;
        }).join('');

        return `
            <div class="explorer-tenant-group">
                <div class="explorer-tenant-row open" data-group-prefix="${prefix}">
                    <i data-lucide="folder-open"></i>
                    <span>${escapeHtml(tenant.name || tenant.tenant_id)}</span>
                    <i data-lucide="chevron-right" class="explorer-chevron"></i>
                </div>
                <div class="explorer-files-list open" id="explorer-files-${prefix}">
                    ${filesHtml}
                </div>
            </div>
        `;
    }).join('');
}

function renderExplorerTree(tenants) {
    const body = document.getElementById('explorer-tree-body');
    if (!body) return;

    if (!tenants || tenants.length === 0) {
        body.innerHTML = `
            <div class="explorer-empty">
                <i data-lucide="inbox"></i>
                <h2>Nenhum arquivo indexado</h2>
                <p>Documentos recebidos via e-mail aparecerão aqui após serem indexados.</p>
            </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    body.innerHTML = `
        <!-- Seção 1: Chat ao vivo -->
        <div class="explorer-root-section">
            <div class="explorer-root-row chat-root open" data-root="chat">
                <i data-lucide="message-circle"></i>
                <span>Representantes &amp; Arquivos</span>
                <i data-lucide="chevron-right" class="explorer-chevron"></i>
            </div>
            <div class="explorer-root-children open" id="root-chat-children">
                ${buildFilesHtml(tenants, 'chat')}
            </div>
        </div>

        <!-- Seção 2: Assistente de IA -->
        <div class="explorer-root-section">
            <div class="explorer-root-row ai-root open" data-root="ai">
                <i data-lucide="bot"></i>
                <span>Assistente de IA</span>
                <i data-lucide="chevron-right" class="explorer-chevron"></i>
            </div>
            <div class="explorer-root-children open" id="root-ai-children">
                ${buildFilesHtml(tenants, 'ai')}
            </div>
        </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Toggle raiz
    body.querySelectorAll('.explorer-root-row').forEach(row => {
        row.addEventListener('click', () => {
            const rootKey = row.dataset.root;
            const children = document.getElementById(`root-${rootKey}-children`);
            if (!children) return;
            const isOpen = children.classList.contains('open');
            children.classList.toggle('open', !isOpen);
            row.classList.toggle('open', !isOpen);
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    });

    // Toggle sub-pastas (representantes)
    body.querySelectorAll('.explorer-tenant-row').forEach(row => {
        row.addEventListener('click', () => {
            const prefix = row.dataset.groupPrefix;
            const list = document.getElementById(`explorer-files-${prefix}`);
            if (!list) return;
            const isOpen = list.classList.contains('open');
            list.classList.toggle('open', !isOpen);
            row.classList.toggle('open', !isOpen);
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    });

    // Clique em arquivo
    body.querySelectorAll('.explorer-file-item').forEach(btn => {
        btn.addEventListener('click', () => {
            body.querySelectorAll('.explorer-file-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const mode = btn.dataset.mode;
            const tenantId = btn.dataset.tenantId;
            const filename = btn.dataset.filename;
            const remoteJid = btn.dataset.remoteJid;
            const instance = btn.dataset.instance;
            const tenantName = btn.dataset.tenantName;

            explorerState.selectedTenantId = tenantId;
            explorerState.selectedFilename = filename;
            explorerState.selectedRemoteJid = remoteJid;
            explorerState.selectedInstance = instance;
            explorerState.selectedTenantName = tenantName;
            explorerState.mode = mode;

            if (mode === 'chat') {
                showChatMode(tenantName, remoteJid, filename, tenantId);
            } else {
                showAiMode(tenantId, filename, tenantName);
            }
        });
    });
}

/* ============================================================
   MODO CHAT — histórico + compositor de mensagem
   ============================================================ */

function showChatMode(tenantName, remoteJid, filename, tenantId) {
    // Restaura a estrutura original do painel central e direito
    const centerPanel = document.getElementById('explorer-center-panel');
    const rightPanel = document.getElementById('explorer-right-panel');

    if (centerPanel) {
        centerPanel.innerHTML = `
            <div class="explorer-panel-header" id="explorer-chat-header">
                <h3>Chat: <span style="color:var(--accent);font-weight:500;font-size:13px;">${escapeHtml(filename)}</span></h3>
                <p class="explorer-panel-meta">Histórico relacionado ao arquivo</p>
            </div>
            <div class="explorer-chat-body" id="explorer-chat-body">
                <div class="explorer-empty"><i data-lucide="loader-circle"></i><p>Carregando...</p></div>
            </div>
        `;
    }

    if (rightPanel) {
        rightPanel.innerHTML = `
            <div class="explorer-panel-header">
                <h3>Enviar Mensagem</h3>
                <p class="explorer-panel-meta">Dispare uma mensagem ao representante</p>
            </div>
            <div class="explorer-composer-body">
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Representante</span>
                    <div class="explorer-composer-info" id="composer-rep-info">
                        <i data-lucide="user-round"></i>
                        <strong>${escapeHtml(tenantName)}</strong>
                        &nbsp;<span style="color:var(--text-muted);font-size:11px;">${escapeHtml(remoteJid?.replace('@s.whatsapp.net',''))}</span>
                    </div>
                </div>
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Arquivo de contexto</span>
                    <div class="explorer-composer-info">
                        <i data-lucide="file-text"></i>
                        <strong>${escapeHtml(filename)}</strong>
                    </div>
                </div>
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Mensagem</span>
                    <textarea
                        class="explorer-composer-textarea"
                        id="composer-message"
                        placeholder="Digite a mensagem para o representante..."
                        rows="5"
                    ></textarea>
                </div>
                <div class="explorer-composer-row">
                    <div class="explorer-composer-preview-label">Prévia da mensagem que será enviada</div>
                    <div class="explorer-composer-preview visible" id="composer-preview">---</div>
                </div>
            </div>
            <div class="explorer-composer-footer">
                <div class="explorer-send-status" id="explorer-send-status">
                    <i data-lucide="check-circle"></i> Enviado com sucesso!
                </div>
                <button class="btn-primary" id="composer-send-btn">
                    <i data-lucide="send"></i> Enviar via WhatsApp
                </button>
            </div>
        `;
        document.getElementById('composer-message')?.addEventListener('input', onComposerInput);
        document.getElementById('composer-send-btn')?.addEventListener('click', sendAdminMessage);
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadFileChat(tenantId, filename);
}

/* ============================================================
   MODO AI — editor de prompt por arquivo
   ============================================================ */

function showAiMode(tenantId, filename, tenantName) {
    const centerPanel = document.getElementById('explorer-center-panel');
    const rightPanel = document.getElementById('explorer-right-panel');

    const promptKey = `${tenantId}:${filename}`;
    const savedPrompt = explorerState.aiPrompts[promptKey] || '';
    const isCustom = !!savedPrompt;
    const currentPrompt = savedPrompt || adminConfig.defaultSystemPrompt;

    if (centerPanel) {
        centerPanel.innerHTML = `
            <div class="explorer-ai-editor-header">
                <div>
                    <h3 style="font-size:15px;font-weight:700;margin-bottom:4px;">Prompt do Assistente</h3>
                    <div class="explorer-ai-editor-meta">
                        <i data-lucide="file-text"></i>
                        <span>${escapeHtml(filename)}</span>
                        <span class="explorer-ai-status ${isCustom ? 'custom' : 'default'}">
                            <i data-lucide="${isCustom ? 'sparkles' : 'shield'}"></i>
                            ${isCustom ? 'Personalizado' : 'Padrão do sistema'}
                        </span>
                    </div>
                </div>
            </div>
            <div class="explorer-ai-editor-body">
                <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
                    Este prompt orienta o assistente ao responder perguntas sobre este documento.
                    Edite abaixo para personalizar o comportamento exclusivamente para <strong>${escapeHtml(filename)}</strong>.
                </div>
                <textarea
                    class="explorer-composer-textarea prompt-field"
                    id="ai-prompt-editor"
                    rows="16"
                    spellcheck="false"
                    placeholder="Instruções do sistema para o assistente..."
                >${escapeHtml(currentPrompt)}</textarea>
                <div class="explorer-ai-editor-actions">
                    <button class="btn-save-prompt" id="btn-save-ai-prompt">
                        <i data-lucide="save"></i> Salvar prompt
                    </button>
                    <button class="btn-reset-prompt" id="btn-reset-ai-prompt">
                        <i data-lucide="rotate-ccw"></i> Restaurar padrão
                    </button>
                    <div class="explorer-ai-save-feedback" id="ai-save-feedback">
                        <i data-lucide="check-circle"></i> Prompt salvo!
                    </div>
                </div>
            </div>
        `;

        document.getElementById('btn-save-ai-prompt')?.addEventListener('click', () => saveAiPrompt(tenantId, filename));
        document.getElementById('btn-reset-ai-prompt')?.addEventListener('click', () => {
            const el = document.getElementById('ai-prompt-editor');
            if (el) el.value = adminConfig.defaultSystemPrompt;
        });
    }

    if (rightPanel) {
        rightPanel.innerHTML = `
            <div class="explorer-panel-header">
                <h3>Informações do Arquivo</h3>
                <p class="explorer-panel-meta">Detalhes e configuração</p>
            </div>
            <div class="explorer-ai-info-body">
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Representante</span>
                    <div class="explorer-composer-info">
                        <i data-lucide="user-round"></i>
                        <strong>${escapeHtml(tenantName)}</strong>
                    </div>
                </div>
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Arquivo</span>
                    <div class="explorer-composer-info">
                        <i data-lucide="file-text"></i>
                        <strong style="word-break:break-all">${escapeHtml(filename)}</strong>
                    </div>
                </div>
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Status do prompt</span>
                    <div class="explorer-composer-info">
                        <i data-lucide="${isCustom ? 'sparkles' : 'shield'}" style="color:${isCustom ? '#fbbf24' : 'var(--text-muted)'}"></i>
                        <span>${isCustom ? 'Prompt personalizado salvo' : 'Usando prompt padrão do sistema'}</span>
                    </div>
                </div>
                ${isCustom ? `
                <div class="explorer-composer-row">
                    <span class="explorer-composer-label">Ações</span>
                    <button class="btn-reset-prompt" style="width:100%;justify-content:center;" id="btn-delete-ai-prompt">
                        <i data-lucide="trash-2"></i> Remover prompt customizado
                    </button>
                </div>` : ''}
                <div style="margin-top:auto;padding-top:16px;font-size:12px;color:var(--text-muted);line-height:1.7;border-top:1px solid var(--glass-border);">
                    <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
                    O prompt salvo aqui é aplicado <strong>exclusivamente</strong> para consultas sobre este arquivo por este representante.
                    Quando não há prompt salvo, o sistema usa as instruções padrão.
                </div>
            </div>
        `;

        document.getElementById('btn-delete-ai-prompt')?.addEventListener('click', () => deleteAiPrompt(tenantId, filename));
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function saveAiPrompt(tenantId, filename) {
    const promptEl = document.getElementById('ai-prompt-editor');
    const feedback = document.getElementById('ai-save-feedback');
    if (!promptEl) return;

    const prompt = promptEl.value.trim();
    try {
        await fetch('api/explorer/ai-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, filename, prompt }),
        });
        explorerState.aiPrompts[`${tenantId}:${filename}`] = prompt;

        if (feedback) {
            feedback.classList.add('visible');
            setTimeout(() => feedback.classList.remove('visible'), 3000);
        }

        // Atualiza o badge de status sem recarregar tudo
        const statusEl = document.querySelector('.explorer-ai-status');
        if (statusEl) {
            statusEl.className = 'explorer-ai-status custom';
            statusEl.innerHTML = '<i data-lucide="sparkles"></i> Personalizado';
        }

        // Atualiza o dot da árvore para o arquivo AI
        renderExplorerTree(explorerState.tenants);
        // Reseleciona o arquivo na seção AI para manter o estado
        setTimeout(() => {
            document.querySelectorAll(`.explorer-file-item[data-mode="ai"][data-tenant-id="${CSS.escape(tenantId)}"][data-filename="${CSS.escape(filename)}"]`).forEach(b => b.classList.add('active'));
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 50);
    } catch (err) {
        alert('Erro ao salvar prompt: ' + err.message);
    }
}

async function deleteAiPrompt(tenantId, filename) {
    if (!confirm('Remover o prompt personalizado e voltar ao padrão?')) return;
    try {
        await fetch('api/explorer/ai-prompts', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, filename }),
        });
        delete explorerState.aiPrompts[`${tenantId}:${filename}`];
        showAiMode(tenantId, filename, explorerState.selectedTenantName);
        renderExplorerTree(explorerState.tenants);
    } catch (err) {
        alert('Erro ao remover prompt: ' + err.message);
    }
}

async function loadFileChat(tenantId, filename) {
    const body = document.getElementById('explorer-chat-body');
    if (!body) return;

    body.innerHTML = `<div class="explorer-empty"><i data-lucide="loader-circle"></i><p>Carregando...</p></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        const res = await fetch(`api/explorer/${encodeURIComponent(tenantId)}/file/${encodeURIComponent(filename)}`);
        const data = await res.json();

        const allEntries = [
            ...data.documentEntries.map(e => ({ ...e, _type: 'doc' })),
            ...data.conversations.map(e => ({ ...e, _type: 'user' })),
            ...data.adminMessages.map(e => ({ ...e, _type: 'admin' })),
        ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (allEntries.length === 0) {
            body.innerHTML = `
                <div class="explorer-empty">
                    <i data-lucide="message-square-off"></i>
                    <h2>Sem interações registradas</h2>
                    <p>Nenhuma conversa encontrada para este arquivo ainda.</p>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        body.innerHTML = allEntries.map(entry => {
            const date = formatDate(entry.timestamp);

            if (entry._type === 'doc') {
                const isForwarded = entry.eventType === 'document_forwarded';
                return `
                    <div class="explorer-chat-entry doc-event">
                        <div class="explorer-entry-header">
                            <span class="explorer-role-badge doc">
                                <i data-lucide="${isForwarded ? 'upload-cloud' : 'file-check'}"></i>
                                ${isForwarded ? 'Documento recebido' : 'Pós-ingestão'}
                            </span>
                            <span class="explorer-entry-time">${date}</span>
                        </div>
                        <div class="explorer-entry-question" style="color:var(--text-muted);font-style:italic;">${escapeHtml(entry.question || '')}</div>
                    </div>`;
            }

            if (entry._type === 'admin') {
                return `
                    <div class="explorer-chat-entry admin-message">
                        <div class="explorer-entry-header">
                            <span class="explorer-role-badge admin"><i data-lucide="shield-check"></i> Admin</span>
                            <span class="explorer-entry-time">${date}</span>
                        </div>
                        <div class="explorer-entry-question">${escapeHtml(entry.question?.replace('[ADMIN] ', '') || '')}</div>
                    </div>`;
            }

            return `
                <div class="explorer-chat-entry">
                    <div class="explorer-entry-header">
                        <span class="explorer-role-badge user"><i data-lucide="user-round"></i> Usuário</span>
                        <span class="explorer-entry-time">${date}</span>
                    </div>
                    <div class="explorer-entry-question">${escapeHtml(entry.question || '-')}</div>
                    <div class="explorer-entry-answer">
                        <span class="explorer-role-badge assistant" style="display:inline-flex;margin-bottom:6px;"><i data-lucide="bot"></i> Assistente</span><br>
                        ${escapeHtml(entry.answer || '-')}
                    </div>
                </div>`;
        }).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('Erro ao carregar chat do arquivo:', err);
        body.innerHTML = `<div class="explorer-empty"><i data-lucide="wifi-off"></i><p>Erro ao carregar histórico.</p></div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function onComposerInput() {
    const msgEl = document.getElementById('composer-message');
    const previewEl = document.getElementById('composer-preview');
    const filename = explorerState.selectedFilename;

    if (!msgEl || !previewEl) return;
    const msg = msgEl.value.trim();

    if (!msg) { previewEl.textContent = '---'; return; }

    if (filename) {
        const followUp = adminConfig.contextMessageTemplate.replace('{{filename}}', filename);
        previewEl.textContent = `📁 Mensagem do Administrador\n\n${msg}\n\n---\n${followUp}`;
    } else {
        previewEl.textContent = `📁 Mensagem do Administrador\n\n${msg}`;
    }
}

async function sendAdminMessage() {
    const msgEl = document.getElementById('composer-message');
    const sendBtn = document.getElementById('composer-send-btn');
    const statusEl = document.getElementById('explorer-send-status');
    const { selectedTenantId, selectedFilename, selectedRemoteJid, selectedInstance } = explorerState;

    if (!selectedTenantId || !selectedRemoteJid || !selectedInstance) {
        alert('Selecione um arquivo na árvore antes de enviar.');
        return;
    }
    const message = msgEl?.value?.trim();
    if (!message) { alert('Digite uma mensagem.'); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Enviando...';

    try {
        const res = await fetch(`api/explorer/${encodeURIComponent(selectedTenantId)}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                filename: selectedFilename,
                remoteJid: selectedRemoteJid,
                whatsapp_instance: selectedInstance,
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'SEND_FAILED');
        }

        if (msgEl) msgEl.value = '';
        onComposerInput();

        if (statusEl) {
            statusEl.classList.add('visible');
            setTimeout(() => statusEl.classList.remove('visible'), 4000);
        }

        if (selectedTenantId && selectedFilename) {
            setTimeout(() => loadFileChat(selectedTenantId, selectedFilename), 800);
        }
    } catch (err) {
        console.error('Erro ao enviar mensagem:', err);
        alert('Falha ao enviar mensagem: ' + err.message);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i data-lucide="send"></i> Enviar via WhatsApp';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}


function setupMenus() {
    const links = document.querySelectorAll('.sidebar nav a');
    const mainContent = document.querySelector('.content');
    const dashboardHtml = mainContent.innerHTML;

    links.forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();

            links.forEach(item => item.classList.remove('active'));
            link.classList.add('active');

            const view = link.dataset.view;
            const label = link.textContent.trim();

            if (view === 'dashboard') {
                mainContent.innerHTML = dashboardHtml;
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }

                const btnRefresh = document.querySelector('.btn-primary');
                if (btnRefresh) {
                    btnRefresh.addEventListener('click', loadData);
                }

                loadData();
                return;
            }

            if (view === 'representatives') {
                loadRepresentativesView();
                return;
            }

            if (view === 'logs') {
                loadChatFlowsView();
                return;
            }

            if (view === 'settings') {
                loadSettingsView();
                return;
            }

            if (view === 'analytics') {
                loadAnalyticsView();
                return;
            }

            if (view === 'explorer') {
                loadExplorerView();
                return;
            }

            renderPlaceholderView(dashboardHtml, label);
        });
    });
}

window.loadData = loadData;
