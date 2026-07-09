import { memo } from 'react';

interface SkeletonProps {
  className?: string;
  count?: number;
  height?: string;
  width?: string;
}

export const Skeleton = memo(function Skeleton({
  className = '',
  count = 1,
  height = '1rem',
  width = '100%',
}: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-gray-200 rounded ${className}`}
          style={{ height, width }}
          aria-hidden="true"
        />
      ))}
    </>
  );
});

export const CardSkeleton = memo(function CardSkeleton() {
  return (
    <div className="card space-y-3">
      <Skeleton height="1.5rem" width="40%" />
      <Skeleton height="1rem" width="60%" />
      <Skeleton height="1rem" width="80%" />
      <Skeleton height="2rem" width="30%" />
    </div>
  );
});

export const TableRowSkeleton = memo(function TableRowSkeleton() {
  return (
    <div className="flex items-center space-x-4 py-3 border-b border-gray-100">
      <Skeleton height="1rem" width="20%" />
      <Skeleton height="1rem" width="25%" />
      <Skeleton height="1rem" width="15%" />
      <Skeleton height="1rem" width="10%" />
    </div>
  );
});

export const ResultSkeleton = memo(function ResultSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="card flex items-center space-x-4">
          <Skeleton height="2rem" width="2rem" className="rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton height="1rem" width="30%" />
            <Skeleton height="0.75rem" width="50%" />
          </div>
          <Skeleton height="1.5rem" width="4rem" />
        </div>
      ))}
    </div>
  );
});