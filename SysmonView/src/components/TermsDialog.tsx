import { useState } from 'react';

/**
 * Terms of Service acceptance dialog.
 * Mirrors Delphi ConfirmationDialogUnit — shown before first external API call.
 * Acceptance is persisted per-service so it only asks once.
 */

interface TermsDialogProps {
  serviceName: string;
  termsUrl: string;
  onAccept: () => void;
  onCancel: () => void;
}

export default function TermsDialog({ serviceName, termsUrl, onAccept, onCancel }: TermsDialogProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
      <div className="bg-surface-800 border border-gray-600 rounded-lg shadow-2xl w-[500px] flex flex-col">
        <div className="px-5 py-3 bg-surface-950 rounded-t-lg border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">
            {serviceName} — Terms of Service
          </h2>
        </div>

        <div className="px-5 py-4 text-sm text-gray-300 leading-relaxed">
          <p>
            You must agree to {serviceName}'s terms of service to use this feature.
          </p>
          <p className="mt-3">
            <button
              onClick={() => window.sysmonApi.shell.openExternal(termsUrl)}
              className="text-blue-400 hover:text-blue-300 underline break-all cursor-pointer"
            >
              {termsUrl}
            </button>
          </p>
        </div>

        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs bg-surface-700 text-gray-300 rounded hover:bg-surface-600"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            className="px-4 py-1.5 text-xs bg-accent-600 text-white rounded hover:bg-accent-500 font-medium"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
