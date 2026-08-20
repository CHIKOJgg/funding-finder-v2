import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SupportButton } from '../components/SupportModal';
import { ToastProvider } from '../components/Toast';
import { LanguageProvider } from '../i18n';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: {
    getSupportTopics: vi.fn().mockResolvedValue({
      ok: true,
      topics: [
        {
          id: 'faq',
          title: 'База знаний & FAQ',
          titleEn: 'FAQ & Knowledge Base',
          description: 'Ответы на частые вопросы',
          descriptionEn: 'Frequently asked questions',
          icon: '📚',
          url: 'https://t.me/fundingfindersupport',
        },
      ],
      supportGroupUrl: 'https://t.me/fundingfindersupport',
    }),
    submitSupportTicket: vi.fn().mockResolvedValue({
      ok: true,
      ticketId: 't123',
      topicUrl: 'https://t.me/fundingfindersupport/42',
      threadId: 42,
    }),
  },
}));

function renderSupport() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <SupportButton />
      </ToastProvider>
    </LanguageProvider>
  );
}

describe('SupportButton / SupportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders support trigger button', () => {
    renderSupport();
    const btn = screen.getByRole('button', { name: /поддержка|support/i });
    expect(btn).toBeInTheDocument();
  });

  it('opens modal and displays Telegram forum topics', async () => {
    renderSupport();
    const btn = screen.getByRole('button', { name: /поддержка|support/i });
    fireEvent.click(btn);

    expect(screen.getByText(/@fundingfindersupport/i)).toBeInTheDocument();
    expect(screen.getByText(/Telegram Forum Supergroup/i)).toBeInTheDocument();
  });

  it('allows switching to Ask Question tab and submitting a ticket', async () => {
    renderSupport();
    const btn = screen.getByRole('button', { name: /поддержка|support/i });
    fireEvent.click(btn);

    // Switch to Ask Question tab
    const askTab = screen.getByText(/Задать вопрос|Ask Question/i);
    fireEvent.click(askTab);

    // Enter question
    const messageInput = screen.getByPlaceholderText(/Подробно опишите|Describe your question/i);
    fireEvent.change(messageInput, { target: { value: 'How does funding rate work?' } });

    // Submit
    const submitBtn = screen.getByText(/Отправить и создать топик|Submit & Create Topic/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.submitSupportTicket).toHaveBeenCalledTimes(1);
    });

    // Check success screen
    await waitFor(() => {
      expect(screen.getByText(/Топик поддержки создан|Support Topic Created/i)).toBeInTheDocument();
    });
  });
});
