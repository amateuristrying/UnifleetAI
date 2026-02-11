import { useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authService, type Role } from '../../services/auth'; // Importing authService directly for creation
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CreateUserModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function CreateUserModal({ isOpen, onClose }: CreateUserModalProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<Role>('tanzania');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);

        try {
            if (password.length < 4) throw new Error('Password must be at least 4 characters');

            const res = await authService.createUser({ username, password, role });
            if (!res.success) throw new Error(res.message);

            setSuccess(`User ${username} created successfully!`);
            setUsername('');
            setPassword('');
            setRole('tanzania');

            // Auto close after 1.5s
            setTimeout(() => {
                onClose();
                setSuccess('');
            }, 1500);

        } catch (err: any) {
            setError(err.message || 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-[400px] bg-surface-card rounded-xl shadow-2xl border border-border transform transition-all animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                        <Plus className="h-5 w-5 text-primary" />
                        Create New User
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Username</label>
                            <Input
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="e.g. jdoe"
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Password</label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Role</label>
                            <Select
                                value={role}
                                onValueChange={(val) => setRole(val as Role)}
                                disabled={isLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="tanzania">Tanzania Ops</SelectItem>
                                    <SelectItem value="zambia">Zambia Ops</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {error && (
                            <p className="text-sm text-destructive font-medium bg-destructive/10 p-2 rounded">
                                {error}
                            </p>
                        )}

                        {success && (
                            <p className="text-sm text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 p-2 rounded">
                                {success}
                            </p>
                        )}

                        <div className="pt-2 flex gap-3">
                            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isLoading}>
                                Cancel
                            </Button>
                            <Button type="submit" className="flex-1" disabled={isLoading}>
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create User'}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
