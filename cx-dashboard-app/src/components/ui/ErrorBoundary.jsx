import { Component } from 'react';
import EmptyState from './EmptyState';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card">
          <EmptyState
            title="Something went wrong"
            message={this.state.error.message}
            error
          />
        </div>
      );
    }
    return this.props.children;
  }
}
