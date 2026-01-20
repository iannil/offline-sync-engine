import { useState, useEffect, useCallback } from 'react';
import { OfflineClient, type Todo, type OutboxAction, type NetworkStatus, ActionType } from '@offline-sync/sdk';
import { SyncStatus } from './components/SyncStatus';
import { OutboxList } from './components/OutboxList';
import './App.css';

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [clientReady, setClientReady] = useState(false);
  const [client, setClient] = useState<OfflineClient | null>(null);
  const [outboxActions, setOutboxActions] = useState<OutboxAction[]>([]);
  const [showOutbox, setShowOutbox] = useState(false);

  // Initialize SDK Client
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let outboxSubscription: { unsubscribe: () => void } | null = null;

    async function initClient() {
      try {
        // Initialize the SDK Client
        const sdkClient = new OfflineClient({
          database: {
            name: 'offline-sync-demo',
          },
          sync: {
            enabled: true,
            url: 'http://localhost:3000/api/sync',
            interval: 30000,
          },
          outbox: {
            maxRetries: 5,
            retryDelay: 1000,
          },
        });

        await sdkClient.init();
        setClient(sdkClient);
        setClientReady(true);

        // Subscribe to network status
        const networkManager = sdkClient.getNetworkManager();
        setIsOnline(networkManager.isOnline);
        const networkSub = networkManager.status$.subscribe((status: NetworkStatus) => {
          setIsOnline(status.isOnline);
        });

        // Get the database and subscribe to todo changes
        const db = sdkClient.getDatabase();
        const query = db.todos.find();
        subscription = query.$.subscribe((results: any) => {
          const todosData = results.map((doc: any) => doc.toJSON());
          setTodos(todosData.filter((t: Todo) => !t.deleted));
        });

        // Subscribe to outbox changes
        const outboxManager = sdkClient.getOutboxManager();
        outboxSubscription = outboxManager.observe$().subscribe((results: any) => {
          setOutboxActions(results.slice(0, 50));
        });

        return () => {
          networkSub.unsubscribe();
        };
      } catch (error) {
        console.error('Failed to initialize SDK client:', error);
      }
    }

    const cleanupPromise = initClient();

    return () => {
      cleanupPromise.then((cleanup) => cleanup && cleanup());
      if (subscription) {
        subscription.unsubscribe();
      }
      if (outboxSubscription) {
        outboxSubscription.unsubscribe();
      }
    };
  }, []);

  // Helper functions
  const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  const nowISO = (): string => {
    return new Date().toISOString();
  };

  // Add a new todo (using Outbox pattern)
  const handleAdd = useCallback(async () => {
    if (!inputValue.trim() || !client) return;

    const newTodo: Omit<Todo, 'deleted'> = {
      id: generateId(),
      text: inputValue.trim(),
      completed: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    try {
      const db = client.getDatabase();
      await db.todos.insert(newTodo);

      // Enqueue the action to outbox for sync
      const outboxManager = client.getOutboxManager();
      await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        newTodo.id,
        newTodo as any
      );

      setInputValue('');
    } catch (error) {
      console.error('Failed to add todo:', error);
    }
  }, [inputValue, client]);

  // Toggle todo completion
  const handleToggle = useCallback(async (id: string, completed: boolean) => {
    if (!client) return;

    try {
      const db = client.getDatabase();
      const doc = await db.todos.findOne().where('id').equals(id).exec();
      if (doc) {
        const updateData = {
          completed: !completed,
          updatedAt: nowISO(),
        };
        await doc.patch(updateData);

        // Enqueue UPDATE action to outbox
        const outboxManager = client.getOutboxManager();
        await outboxManager.enqueue(
          ActionType.UPDATE,
          'todos',
          id,
          updateData
        );
      }
    } catch (error) {
      console.error('Failed to toggle todo:', error);
    }
  }, [client]);

  // Delete a todo (soft delete)
  const handleDelete = useCallback(async (id: string) => {
    if (!client) return;

    try {
      const db = client.getDatabase();
      const doc = await db.todos.findOne().where('id').equals(id).exec();
      if (doc) {
        const deleteData = {
          deleted: true,
          updatedAt: nowISO(),
        };
        await doc.patch(deleteData);

        // Enqueue DELETE action to outbox
        const outboxManager = client.getOutboxManager();
        await outboxManager.enqueue(
          ActionType.UPDATE, // Using UPDATE for soft delete
          'todos',
          id,
          deleteData
        );
      }
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  }, [client]);

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAdd();
  };

  if (!clientReady) {
    return (
      <div className="container">
        <div className="loading">初始化 SDK 客户端...</div>
      </div>
    );
  }

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;
  const pendingSyncCount = outboxActions.filter((a) => a.status === 'pending').length;

  return (
    <div className="container">
      <header className="header">
        <h1>离线同步引擎 Demo</h1>
        <div className="status">
          <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '🟢 在线' : '🔴 离线'}
          </span>
          <span className="stats">
            {activeCount} 待办 / {completedCount} 已完成
          </span>
          {pendingSyncCount > 0 && (
            <span className="sync-pending">
              ⏳ {pendingSyncCount} 待同步
            </span>
          )}
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowOutbox(!showOutbox)}
          >
            {showOutbox ? '隐藏' : '显示'}队列
          </button>
        </div>
      </header>

      {client && (
        <SyncStatus
          networkManager={client.getNetworkManager()}
          syncManager={client.getSyncManager()}
        />
      )}

      <main className="main">
        <form className="todo-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="todo-input"
            placeholder="添加新的待办事项..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!inputValue.trim()}
          >
            添加
          </button>
        </form>

        <ul className="todo-list">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item ${todo.completed ? 'completed' : ''}`}
            >
              <input
                type="checkbox"
                className="todo-checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo.id, todo.completed)}
              />
              <span className="todo-text">{todo.text}</span>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(todo.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>

        {todos.length === 0 && (
          <div className="empty-state">
            <p>暂无待办事项</p>
            <p className="hint">
              {isOnline
                ? '添加一些待办事项来测试离线功能'
                : '当前处于离线模式，数据将保存在本地并在恢复网络后同步'}
            </p>
          </div>
        )}
      </main>

      {showOutbox && client && (
        <div className="outbox-section">
          <OutboxList outboxManager={client.getOutboxManager()} />
        </div>
      )}

      <footer className="footer">
        <p>
          💡 提示：添加的待办事项会进入同步队列，在恢复网络后自动同步到服务端
        </p>
      </footer>
    </div>
  );
}

export default App;
